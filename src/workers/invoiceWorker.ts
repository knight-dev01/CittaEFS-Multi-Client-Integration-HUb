import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';
import { invoiceQueue, QueueJob, QueueablePayload } from '../queues/invoiceQueue';
import { cittaEfsClient, CittaEfsResponse } from '../services/cittaEfsClient';
import { isValidCittaCode, normalizeCittaCode, getCittaCodeType } from '../data/referenceData';

const prisma = new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });

export interface ProcessingResult {
  jobId: string;
  success: boolean;
  irn?: string;
  error?: string;
  movedToDLQ?: boolean;
}

/**
 * Async Queue Worker processing incoming invoice signing jobs.
 * Enforces exponential backoff retry strategy (5s, 30s, 2m, 10m) for network/gateway timeouts.
 * Routes permanently failing jobs to Dead Letter Queue (DLQ).
 */
export async function processInvoiceJob(
  job: QueueJob<QueueablePayload>
): Promise<ProcessingResult> {
  job.status = 'PROCESSING';
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
  await invoiceQueue.updateJob(job);

  try {
    // 0. Re-normalize HS/Service code at send time against Item dictionary (Option B auto-map)
    const _d:any = job.data as any;
    try {
      const items = await prisma.item.findMany({ where: { tenantId: job.data.tenantId } });
      const inferServiceCode = (sku: string, desc: string) => {
        const text = `${sku} ${desc}`.toLowerCase();
        if (/gardening|garden|sod|rocks|rock|fountain|pump|sprinkler|landscap|trimming|trim|pest|control|lawn|concrete|design|lumber/.test(text)) return "8130"; // Landscape care and maintenance service activities
        if ((sku || "").toUpperCase().startsWith("SRV")) return "6209"; // Other information technology and computer service activities
        if (/laptop|notebook|macbook|computer|desktop|router|switch|\bserver\b/.test(text)) return "8471.30"; // Automatic data processing machines; portable
        return "UNMAPPED";
      };
      for (const li of (job.data.lineItems as any[])) {
        li.hsOrServiceCode = normalizeCittaCode(li.hsOrServiceCode);
        const mapping = items.find(m => m.clientSku === li.itemCode);
        const mappingCode = mapping?.hsOrServiceCode ? normalizeCittaCode(mapping.hsOrServiceCode) : "";
        const inferred = inferServiceCode(li.itemCode || "", li.description || "");
        const inferredIsService = inferred !== "UNMAPPED" && getCittaCodeType(inferred) === "SERVICE_CODE";
        const mappingIsServiceMismatch = mappingCode && getCittaCodeType(mappingCode) === "HS_CODE" && inferredIsService;
        if (inferredIsService && mappingIsServiceMismatch) {
          li.hsOrServiceCode = inferred;
        } else if (mappingCode && isValidCittaCode(mappingCode) && !mappingIsServiceMismatch) {
          li.hsOrServiceCode = normalizeCittaCode(mappingCode);
        } else if (!isValidCittaCode(li.hsOrServiceCode) && isValidCittaCode(inferred)) {
          li.hsOrServiceCode = inferred;
        } else {
          li.hsOrServiceCode = normalizeCittaCode(li.hsOrServiceCode);
        }
      }
      // Strict check — if still invalid, don't retry 5x, go straight to DLQ as validation (Option A)
      const stillInvalid = (job.data.lineItems as any[]).find(li => !isValidCittaCode(li.hsOrServiceCode));
      if (stillInvalid) {
        throw new Error(`Invalid Product Code - must be valid HS Code or Service Code (found ${stillInvalid.hsOrServiceCode} for ${stillInvalid.itemCode})`);
      }
    } catch (e:any) {
      if (e.message && e.message.includes("Invalid Product Code")) throw e;
    }
    // 1. Dispatch payload to CittaEFS Gateway C# REST API — forward all gold fields (header, currency, IRNs, customFields)
    const response: CittaEfsResponse = await cittaEfsClient.signAndStampInvoice({
      tenantId: job.data.tenantId,
      clientInvoiceNumber: job.data.clientInvoiceNumber,
      documentNumber: _d.documentNumber,
      invoiceType: job.data.invoiceType,
      invoiceKind: job.data.invoiceKind,
      customerCode: job.data.customerCode,
      customerName: job.data.customerName,
      customerTin: job.data.customerTin || undefined,
      lineItems: job.data.lineItems,
      issueDate: job.data.issueDate,
      originalIrn: job.data.originalIrn,
      // Gold passthroughs
      ...( _d.invoiceTypeCode ? { invoiceTypeCode: _d.invoiceTypeCode } : {}),
      ...( _d.billingReferenceIrns ? { billingReferenceIrns: _d.billingReferenceIrns } : {}),
      ...( _d.headerDiscount !== undefined ? { headerDiscount: _d.headerDiscount } : {}),
      ...( _d.headerCharges !== undefined ? { headerCharges: _d.headerCharges } : {}),
      ...( _d.currency ? { currency: _d.currency } : {}),
      ...( _d.customFields ? { customFields: _d.customFields } : {}),
      ...( _d.metadata ? { metadata: _d.metadata } : {}),
    } as any);

    if (response.success && response.irn) {
      job.status = 'COMPLETED';
      job.updatedAt = new Date().toISOString();

      // Persist the real gateway result onto the DB invoice row
      await prisma.invoice.update({
        where: { id: job.data.dbInvoiceId },
        data: {
          status: 'APPROVED',
          irn: response.irn,
          csid: response.csid || null,
          qrCodeUrl: response.qrCodeUrl || null,
          rawPayloadHash: job.data.rawPayloadHash || null
        }
      }).catch((e: any) => {
        console.error(`[Worker] Failed to persist gateway result for invoice ${job.data.dbInvoiceId}:`, e.message);
      });

      // Perform Inbound Writeback to Client System (e.g. QuickBooks / NetSuite)
      await cittaEfsClient.executeClientLedgerWriteback(
        job.tenantId,
        job.data.clientInvoiceNumber,
        response.irn,
        response.qrCodeUrl || ''
      );

      await invoiceQueue.removeJob(job.id);
      return { jobId: job.id, success: true, irn: response.irn };
    } else {
      throw new Error(response.message || 'Gateway returned non-success status');
    }
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown network gateway error';
    job.lastError = errorMsg;
    // Validation errors (HS code etc) — don't retry 5x, go straight to DLQ as Validation
    if (errorMsg.includes('Invalid Product Code')) {
      await invoiceQueue.moveToDLQ(job, errorMsg);
      await prisma.invoice.update({ where: { id: job.data.dbInvoiceId }, data: { status: 'REJECTED' } }).catch(()=>{});
      try {
        await prisma.validationError.create({
          data: {
            tenantId: job.tenantId,
            clientInvoiceNumber: job.data.clientInvoiceNumber,
            errorCategory: 'MISSING_HS_CODE',
            fieldAffected: 'hsOrServiceCode',
            errorMessage: errorMsg.slice(0,4000),
            rawPayloadSample: JSON.stringify(job.data).slice(0,2000),
            status: 'OPEN',
          }
        });
      } catch {}
      return { jobId: job.id, success: false, error: errorMsg, movedToDLQ: true };
    }
    // Missing gateway key — don't retry 5x, go straight to DLQ so UI can show 503 actionable error
    if (errorMsg.includes('No CittaEFS Gateway API key') || errorMsg.includes('GATEWAY_NOT_CONFIGURED')) {
      await invoiceQueue.moveToDLQ(job, errorMsg);
      await prisma.invoice.update({ where: { id: job.data.dbInvoiceId }, data: { status: 'REJECTED' } }).catch(()=>{});
      try {
        await prisma.validationError.create({
          data: {
            tenantId: job.tenantId,
            clientInvoiceNumber: job.data.clientInvoiceNumber,
            errorCategory: 'GATEWAY_NOT_CONFIGURED',
            fieldAffected: 'cittaApiKey',
            errorMessage: `Gateway key not configured: ${errorMsg.slice(0,4000)} — set CITTAEFS_API_KEY env var`,
            rawPayloadSample: JSON.stringify(job.data).slice(0,2000),
            status: 'OPEN',
          }
        });
      } catch {}
      return { jobId: job.id, success: false, error: errorMsg, movedToDLQ: true };
    }

    // Check if max retries exceeded
    if (job.attempts >= job.maxRetries) {
      await invoiceQueue.moveToDLQ(job, `Exceeded max retries (${job.maxRetries}). Error: ${errorMsg}`);
      await prisma.invoice.update({
        where: { id: job.data.dbInvoiceId },
        data: { status: 'REJECTED' }
      }).catch(() => {});
      // Surface reason in hub — create ValidationError so Validation Errors tab + Invoices REJECTED filter shows why
      try {
        await prisma.validationError.create({
          data: {
            tenantId: job.tenantId,
            clientInvoiceNumber: job.data.clientInvoiceNumber,
            errorCategory: errorMsg.includes('Gateway') || errorMsg.includes('CittaEFS') ? 'GATEWAY_REJECTED' : 'TRANSMIT_FAILED',
            fieldAffected: 'gateway',
            errorMessage: `CittaEFS gateway rejected after ${job.maxRetries} retries: ${errorMsg.slice(0, 4000)}`,
            rawPayloadSample: JSON.stringify(job.data).slice(0, 2000),
            status: 'OPEN',
          }
        });
      } catch {}
      return {
        jobId: job.id,
        success: false,
        error: errorMsg,
        movedToDLQ: true
      };
    }

    // Schedule next attempt with exponential backoff delay
    job.status = 'QUEUED';
    const backoffDelay = job.backoffMs[Math.min(job.attempts - 1, job.backoffMs.length - 1)];
    job.nextAttemptAt = new Date(Date.now() + backoffDelay).toISOString();
    console.warn(`[Worker] Job ${job.id} failed attempt ${job.attempts}/${job.maxRetries}. Retrying in ${backoffDelay}ms. Error: ${errorMsg}`);
    await invoiceQueue.updateJob(job);
    
    return {
      jobId: job.id,
      success: false,
      error: errorMsg,
      movedToDLQ: false
    };
  }
}

/**
 * Worker Loop: Process all pending items in queue
 */
export async function runWorkerBatch(): Promise<ProcessingResult[]> {
  // Recover orphans that lost queue entry after restart
  await invoiceQueue.recoverOrphans().catch(()=>{});
  // Reclaim jobs abandoned mid-PROCESSING by a dead/restarted worker
  await invoiceQueue.recoverStaleProcessingJobs().catch(()=>{});
  const pendingJobs = invoiceQueue.getPendingJobs();
  const results: ProcessingResult[] = [];

  for (const job of pendingJobs) {
    const res = await processInvoiceJob(job);
    results.push(res);
  }

  return results;
}
