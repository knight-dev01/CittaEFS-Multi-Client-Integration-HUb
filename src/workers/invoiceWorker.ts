import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';
import { invoiceQueue, QueueJob, QueueablePayload } from '../queues/invoiceQueue';
import { cittaEfsClient, CittaEfsResponse } from '../services/cittaEfsClient';

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
    // 1. Dispatch payload to CittaEFS Gateway C# REST API
    const response: CittaEfsResponse = await cittaEfsClient.signAndStampInvoice({
      tenantId: job.data.tenantId,
      clientInvoiceNumber: job.data.clientInvoiceNumber,
      invoiceType: job.data.invoiceType,
      invoiceKind: job.data.invoiceKind,
      customerCode: job.data.customerCode,
      customerName: job.data.customerName,
      customerTin: job.data.customerTin || undefined,
      lineItems: job.data.lineItems,
      issueDate: job.data.issueDate,
      originalIrn: job.data.originalIrn
    });

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
    // Missing gateway key — don't retry 5x, go straight to DLQ so UI can show 503 actionable error
    if (errorMsg.includes('No CittaEFS Gateway API key') || errorMsg.includes('GATEWAY_NOT_CONFIGURED')) {
      await invoiceQueue.moveToDLQ(job, errorMsg);
      await prisma.invoice.update({ where: { id: job.data.dbInvoiceId }, data: { status: 'REJECTED' } }).catch(()=>{});
      return { jobId: job.id, success: false, error: errorMsg, movedToDLQ: true };
    }

    // Check if max retries exceeded
    if (job.attempts >= job.maxRetries) {
      await invoiceQueue.moveToDLQ(job, `Exceeded max retries (${job.maxRetries}). Error: ${errorMsg}`);
      await prisma.invoice.update({
        where: { id: job.data.dbInvoiceId },
        data: { status: 'REJECTED' }
      }).catch(() => {});
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
  const pendingJobs = invoiceQueue.getPendingJobs();
  const results: ProcessingResult[] = [];

  for (const job of pendingJobs) {
    const res = await processInvoiceJob(job);
    results.push(res);
  }

  return results;
}
