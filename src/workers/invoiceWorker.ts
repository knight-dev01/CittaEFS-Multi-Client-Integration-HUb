import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';
import { invoiceQueue, QueueJob, QueueablePayload } from '../queues/invoiceQueue';
import { cittaEfsClient, CittaEfsResponse } from '../services/cittaEfsClient';
import { dispatchMerchantWebhook } from '../services/merchantWebhook';
import { isValidCittaCode, normalizeCittaCode, getCittaCodeType } from '../data/referenceData';
import { formatGatewayErrorMessage } from '../lib/gatewayErrors';
import { writeProblemBackToSourceErp as pushProblemToSourceErp } from '../lib/erpProblemWriteback';
import { findRememberedCode } from "../lib/codeMemory";
import { preflightInvoice } from '../lib/efsPreflight';
import { loadEfsCatalog } from '../services/efsResources';
import { safeAuditLogCreate } from '../lib/serverHelpers';
import { withSourceTag } from '../lib/sourceErpTag';
import { buildInlineCustomer, missingCustomerDetailsMessage, type CustomerDetails, type InlineCustomer } from '../lib/inlineCustomer';

const prisma = new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });

/**
 * Resolves the job's invoice row and hands it to the shared ERP problem
 * writeback. Best-effort: the terminal failure is already recorded, so a dead
 * ERP connection only leaves `ledgerWritebackStatus` as FAILED.
 */
async function writeProblemBackToSourceErp(
  job: QueueJob<QueueablePayload>,
  rawMessage: string,
): Promise<void> {
  const invoice = await prisma.invoice
    .findUnique({
      where: { id: job.data.dbInvoiceId },
      select: {
        sourceErp: true,
        clientInvoiceId: true,
        qboInvoiceId: true,
        odooInvoiceId: true,
      },
    })
    .catch(() => null);
  if (!invoice) return;

  await pushProblemToSourceErp(
    { tenantId: job.tenantId, ...invoice },
    rawMessage,
    {
      invoiceType: job.data.invoiceType,
      invoiceTypeCode: (job.data as any).invoiceTypeCode,
    },
  );
}

async function markSourceInvoicePending(job: QueueJob<QueueablePayload>): Promise<void> {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: job.data.dbInvoiceId },
      select: { sourceErp: true, qboInvoiceId: true, invoiceType: true },
    });
    if (invoice?.sourceErp !== 'qbo' || !invoice.qboInvoiceId) return;
    const { setQboInvoiceStatus, qboEntityForInvoiceType } = await import('../services/qboService');
    const { QBO_STATUS } = await import('../lib/qboCustomFields');
    await setQboInvoiceStatus(job.tenantId, invoice.qboInvoiceId, qboEntityForInvoiceType(invoice.invoiceType), QBO_STATUS.processing);
  } catch (e: any) {
    console.warn(`[Worker] Could not mark source invoice pending for job ${job.id}: ${e?.message}`);
  }
}

/**
 * CittaEFS's inline customer for an unregistered B2B buyer, from the source
 * ERP's live customer record. `missing` lists details to fill in in the ERP;
 * neither field set means the source has no customer reader (registration
 * hold applies). A failed ERP read throws, so the job retries with backoff.
 */
async function resolveInlineCustomer(
  job: QueueJob<QueueablePayload>,
  invoice: { sourceErp: string | null; customerTin: string | null; qboInvoiceId: string | null; invoiceType: string },
): Promise<{ customer?: InlineCustomer; missing?: string[] }> {
  let details: CustomerDetails;
  try {
    if (invoice.sourceErp === 'qbo') {
      const { fetchQboCustomerDetails, qboEntityForInvoiceType } = await import('../services/qboService');
      details = await fetchQboCustomerDetails(job.tenantId, job.data.customerCode, invoice.qboInvoiceId, qboEntityForInvoiceType(invoice.invoiceType));
    } else if (invoice.sourceErp === 'odoo') {
      const { fetchOdooCustomerDetails } = await import('../services/odooService');
      details = await fetchOdooCustomerDetails(job.tenantId, job.data.customerCode);
    } else {
      return {};
    }
  } catch (e: any) {
    throw new Error(`Could not read customer details from ${invoice.sourceErp === 'qbo' ? 'QuickBooks' : 'Odoo'}: ${e?.message || e}`);
  }
  const { customer, missing } = buildInlineCustomer({
    ...details,
    name: details.name || job.data.customerName,
    tin: invoice.customerTin || job.data.customerTin,
  });
  return customer ? { customer } : { missing };
}

export interface ProcessingResult {
  jobId: string;
  success: boolean;
  irn?: string;
  error?: string;
  movedToDLQ?: boolean;
  needsRegistration?: boolean;
  accepted?: boolean;
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

  // First attempt of a (re)queued job: show "Pending" on the QuickBooks invoice
  // while the hub sends it. Best-effort and silent without a Status/Info field.
  if (job.attempts === 1) await markSourceInvoicePending(job);

  try {
    // 0. Re-normalize HS/Service code at send time against Item dictionary (Option B auto-map)
    const _d:any = job.data as any;
    try {
      const items = await prisma.item.findMany({ where: { tenantId: job.data.tenantId } });
      // Tax classification comes ONLY from the operator's Item mapping or the
      // code the source ERP sent. No keyword guessing: a guessed HS/service code
      // on a fiscal invoice is a compliance error, so unmapped lines go to the
      // validation queue (and back to the ERP) for a human to classify.
      for (const li of (job.data.lineItems as any[])) {
        li.hsOrServiceCode = normalizeCittaCode(li.hsOrServiceCode);
        const mapping = items.find(m => m.clientSku === li.itemCode);
        const mappingCode = mapping?.hsOrServiceCode ? normalizeCittaCode(mapping.hsOrServiceCode) : "";
        if (mappingCode && isValidCittaCode(mappingCode)) {
          li.hsOrServiceCode = mappingCode;
        } else if (!isValidCittaCode(li.hsOrServiceCode)) {
          // Same wording as an item a person already classified.
          const remembered = findRememberedCode(items, null, li.description);
          if (remembered) li.hsOrServiceCode = remembered.code;
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

    // 0.4 CittaEFS pre-flight — bring the payload into CittaEFS's exact format
    // (API guide rules + CittaEFS's live configured code lists). Safe fixes are
    // applied and logged; anything no rule can repair holds the invoice with a
    // specific validation error instead of a gateway rejection. Deterministic:
    // no model is involved, and the bundled lists are used if CittaEFS's are
    // unreachable.
    {
      const catalog = await loadEfsCatalog();
      const preflight = preflightInvoice(job.data as any, { catalog });
      Object.assign(job.data as any, preflight.data);
      if (preflight.fixes.length) {
        await safeAuditLogCreate(prisma, {
          tenantId: job.tenantId,
          action: 'EFS_PREFLIGHT_NORMALISED',
          entityType: 'Invoice',
          entityRef: job.data.clientInvoiceNumber,
          details: preflight.fixes.map(f => `${f.field}: "${f.from}" -> "${f.to}" (${f.rule})`).join('\n').slice(0, 4000),
        }).catch(() => {});
      }
      if (preflight.issues.length) {
        const message = `CittaEFS pre-flight: ${preflight.issues.length} problem(s) must be fixed in the ERP before this invoice can be stamped:\n` +
          preflight.issues.map(i => `- ${i.message}`).join('\n');
        await invoiceQueue.moveToDLQ(job, message);
        await prisma.invoice.update({ where: { id: job.data.dbInvoiceId }, data: { status: 'REJECTED' } }).catch(() => {});
        await writeProblemBackToSourceErp(job, message);
        dispatchMerchantWebhook(job.tenantId, job.data.dbInvoiceId, 'invoice.rejected').catch(() => {});
        await prisma.validationError.create({
          data: {
            tenantId: job.tenantId,
            clientInvoiceNumber: job.data.clientInvoiceNumber,
            errorCategory: preflight.issues[0].category,
            fieldAffected: preflight.issues.map(i => i.field).join(', ').slice(0, 250),
            errorMessage: message.slice(0, 4000),
            rawPayloadSample: JSON.stringify(job.data).slice(0, 2000),
            status: 'OPEN',
          },
        }).catch(() => {});
        return { jobId: job.id, success: false, error: message, movedToDLQ: true };
      }
    }

    // 0.6 Item registration tracking — non-blocking, unlike the customer gate
    // below. CittaEFS's own spec contradicts itself on whether items need
    // pre-registration (Interface sheet says yes; the Item sheet's dedicated
    // B2C answer says no, full item details go inline), so this only tracks
    // new items for later export/registration — it never holds up transmission.
    // Isolated in its own try/catch so a failure here can't affect sending.
    try {
      const invoiceForItems = await prisma.invoice.findUnique({
        where: { id: job.data.dbInvoiceId },
        select: { sourceErp: true },
      });
      for (const li of (job.data.lineItems as any[])) {
        const itemCode = li.itemCode;
        if (!itemCode) continue;
        await prisma.entityMapping.upsert({
          where: {
            tenantId_entityType_sourceErpId: {
              tenantId: job.data.tenantId,
              entityType: 'ITEM',
              sourceErpId: itemCode,
            },
          },
          update: {
            displayName: li.description || itemCode,
          },
          create: {
            tenantId: job.data.tenantId,
            entityType: 'ITEM',
            sourceErp: invoiceForItems?.sourceErp || 'unknown',
            sourceErpId: itemCode,
            displayName: li.description || itemCode,
            status: 'PENDING_REGISTRATION',
          },
        });
      }
    } catch (e: any) {
      console.warn(`[Worker] Item registration tracking failed for job ${job.id} (non-blocking):`, e.message);
    }

    // 0.5 B2B/B2G buyer. A buyer registered in CittaEFS (mapping MAPPED) is
    // sent by customerCode. Any other buyer from QuickBooks or Odoo is sent as
    // CittaEFS's inline customer, read live from the ERP: the CittaEFS API
    // guide ("Customer Options") says an inline customer "does not need to
    // already exist as a customer record". Missing details hold the invoice
    // and tell the ERP which ones. Other sources keep the registration hold
    // (CittaHub_Section_E_Spec-5.xlsx, Interface sheet). B2C is exempt.
    // Item registration is deliberately NOT gated here — the spec's own answers
    // conflict (Interface sheet says items must be registered; the Item sheet's
    // dedicated B2C answer says "item is not registered for integration — full
    // item details are required"). Needs a confirmed answer before extending
    // this gate to items.
    // Decided afresh each attempt: a buyer registered since the last try goes by code.
    delete _d.inlineCustomer;
    if (job.data.invoiceKind === 'B2B' || job.data.invoiceKind === 'B2G') {
      const mapping = await prisma.entityMapping.findUnique({
        where: {
          tenantId_entityType_sourceErpId: {
            tenantId: job.data.tenantId,
            entityType: 'CUSTOMER',
            sourceErpId: job.data.customerCode,
          },
        },
      });
      if (!mapping || mapping.status !== 'MAPPED') {
        const invoice = await prisma.invoice.findUnique({ where: { id: job.data.dbInvoiceId } });
        if (!invoice) {
          // Orphaned job with no backing Invoice row — a data-integrity
          // anomaly (e.g. a stale test/leftover job), not a real
          // registration case. Don't pollute EntityMapping with a row for a
          // customer we can't actually trace back to an invoice.
          await invoiceQueue.moveToDLQ(job, `No Invoice record found for dbInvoiceId ${job.data.dbInvoiceId} — orphaned job, cannot process`);
          return { jobId: job.id, success: false, error: 'Orphaned job: invoice record not found', movedToDLQ: true };
        }
        await prisma.entityMapping.upsert({
          where: {
            tenantId_entityType_sourceErpId: {
              tenantId: job.data.tenantId,
              entityType: 'CUSTOMER',
              sourceErpId: job.data.customerCode,
            },
          },
          update: {
            displayName: job.data.customerName,
            tin: job.data.customerTin || null,
          },
          create: {
            tenantId: job.data.tenantId,
            entityType: 'CUSTOMER',
            sourceErp: invoice?.sourceErp || 'unknown',
            sourceErpId: job.data.customerCode,
            displayName: job.data.customerName,
            tin: job.data.customerTin || null,
            status: 'PENDING_REGISTRATION',
          },
        });
        const inline = await resolveInlineCustomer(job, invoice);
        if (inline.customer) {
          _d.inlineCustomer = inline.customer;
        } else if (inline.missing) {
          const message = missingCustomerDetailsMessage(job.data.customerName, inline.missing);
          await invoiceQueue.moveToDLQ(job, message);
          await prisma.invoice.update({ where: { id: job.data.dbInvoiceId }, data: { status: 'REJECTED' } }).catch(() => {});
          await writeProblemBackToSourceErp(job, message);
          dispatchMerchantWebhook(job.tenantId, job.data.dbInvoiceId, 'invoice.rejected').catch(() => {});
          await prisma.validationError.create({
            data: {
              tenantId: job.tenantId,
              clientInvoiceNumber: job.data.clientInvoiceNumber,
              errorCategory: 'CUSTOMER_DETAILS',
              fieldAffected: inline.missing.join(', ').slice(0, 250),
              errorMessage: message.slice(0, 4000),
              rawPayloadSample: JSON.stringify(job.data).slice(0, 2000),
              sourceErp: invoice.sourceErp,
              status: 'OPEN',
            },
          }).catch(() => {});
          return { jobId: job.id, success: false, error: message, movedToDLQ: true };
        }
      }
      if ((!mapping || mapping.status !== 'MAPPED') && !_d.inlineCustomer) {
        await prisma.invoice.update({
          where: { id: job.data.dbInvoiceId },
          data: { status: 'NEEDS_EFS_REGISTRATION' },
        }).catch((e: any) => {
          console.error(`[Worker] Failed to set NEEDS_EFS_REGISTRATION for invoice ${job.data.dbInvoiceId}:`, e.message);
        });
        // Not a transient failure — retrying won't register the customer. Remove
        // from the active queue; Phase 3's "Confirm Registered" action requeues it.
        await invoiceQueue.removeForRegistration(job.id, `Awaiting CittaEFS registration for customer ${job.data.customerCode}`);
        console.warn(`[Worker] Job ${job.id} needs EFS customer registration for ${job.data.customerCode} — removed from queue, not retried.`);
        return { jobId: job.id, success: false, needsRegistration: true };
      }
    }

    // 0.7 Tag the source ERP in CittaEFS's metadata / custom fields (never the
    // NRS-registered invoice number) so CittaEFS shows where it came from.
    {
      const source = await prisma.invoice.findUnique({
        where: { id: job.data.dbInvoiceId },
        select: { sourceErp: true, clientInvoiceId: true, documentNumber: true },
      }).catch(() => null);
      const tagged = withSourceTag(
        { metadata: _d.metadata, customFields: _d.customFields },
        {
          hubInvoiceId: job.data.dbInvoiceId,
          sourceErp: source?.sourceErp,
          sourceInvoiceNumber: source?.documentNumber || source?.clientInvoiceId || job.data.clientInvoiceNumber,
        },
      );
      _d.metadata = tagged.metadata;
      _d.customFields = tagged.customFields;
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
      ...( _d.inlineCustomer ? { inlineCustomer: _d.inlineCustomer } : {}),
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

      // Notify merchant webhook (Interswitch-style signed callback) — non-blocking
      dispatchMerchantWebhook(job.tenantId, job.data.dbInvoiceId, 'invoice.authorized').catch(()=>{});

      await invoiceQueue.removeJob(job.id);
      return { jobId: job.id, success: true, irn: response.irn };
    } else if (response.success && response.accepted) {
      // Current CittaEFS contract: the batch was accepted, but the IRN/QR
      // stamp arrives asynchronously via invoice.signed / invoice.transmitted
      // webhooks or the archive reconciliation cron.
      job.status = 'COMPLETED';
      job.updatedAt = new Date().toISOString();
      // The signed/transmitted webhook can arrive before this HTTP response:
      // never turn an invoice it already stamped back to pending.
      await prisma.invoice.updateMany({
        where: { id: job.data.dbInvoiceId, status: { notIn: ['APPROVED', 'SIGNED'] } },
        data: {
          status: 'PENDING_NRS_STAMP',
          rawPayloadHash: job.data.rawPayloadHash || null,
        },
      }).catch((e: any) => {
        console.error(`[Worker] Failed to mark invoice ${job.data.dbInvoiceId} PENDING_NRS_STAMP:`, e.message);
      });
      await invoiceQueue.removeJob(job.id);
      return { jobId: job.id, success: true, accepted: true };
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
      await writeProblemBackToSourceErp(job, errorMsg);
      dispatchMerchantWebhook(job.tenantId, job.data.dbInvoiceId, 'invoice.rejected').catch(()=>{});
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
      dispatchMerchantWebhook(job.tenantId, job.data.dbInvoiceId, 'invoice.rejected').catch(()=>{});
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

    // A 4xx is a refusal of this payload, not a transient fault: the gateway
    // parsed the request and rejected it in its own validation or SQL layer.
    // Replaying the same DTO five times only repeats the failure and hides the
    // cause behind "rejected after 5 retries". 408/429 still retry.
    const gatewayStatus = (err as any).httpStatus as number | undefined;
    const refusedPayload =
      (err as any).retryable === false ||
      (gatewayStatus !== undefined &&
        gatewayStatus >= 400 &&
        gatewayStatus < 500 &&
        gatewayStatus !== 408 &&
        gatewayStatus !== 429);
    if (refusedPayload) {
      const isPermanentBusinessError =
        /already posted|already been posted|duplicate invoice|invoice number already|wm_001_ei_ar/i.test(errorMsg) ||
        /check constraint/i.test(errorMsg) ||
        /unauthori[sz]ed|forbidden|invalid (api )?key|invalid token|bearer/i.test(errorMsg) ||
        /invoice ?type.*(not configured|invalid|required|must be)|valid configured invoice type/i.test(errorMsg);
      const isRetryableValidation =
        !isPermanentBusinessError &&
        (/billing reference|billingreference|original irn|original invoice/i.test(errorMsg) ||
         /self[- ]billed|customer tin|\btin\b.*(invalid|required|missing)/i.test(errorMsg) ||
         /hsorservice|hs code|service code|invalid product code|product code/i.test(errorMsg));

      if (isRetryableValidation) {
        // Allow auto-retry for correctable business validation errors.
        // Write problem back each attempt so ERP stays in sync, but keep the job alive.
        await writeProblemBackToSourceErp(job, errorMsg);
        // fall through to backoff/retry logic below
      } else {
        // Permanent refusal — DLQ immediately.
        await invoiceQueue.moveToDLQ(job, errorMsg);
        await prisma.invoice.update({
          where: { id: job.data.dbInvoiceId },
          data: { status: 'REJECTED' }
        }).catch(() => {});
        await writeProblemBackToSourceErp(job, errorMsg);
        dispatchMerchantWebhook(job.tenantId, job.data.dbInvoiceId, 'invoice.rejected').catch(()=>{});
        try {
          await prisma.validationError.create({
            data: {
              tenantId: job.tenantId,
              clientInvoiceNumber: job.data.clientInvoiceNumber,
              errorCategory: 'GATEWAY_REJECTED',
              fieldAffected: 'gateway',
              errorMessage: formatGatewayErrorMessage(errorMsg, {
                invoiceType: job.data.invoiceType,
                invoiceTypeCode: (job.data as any).invoiceTypeCode,
              }).slice(0, 4000),
              rawPayloadSample: JSON.stringify(job.data).slice(0, 2000),
              status: 'OPEN',
            }
          });
        } catch {}
        return { jobId: job.id, success: false, error: errorMsg, movedToDLQ: true };
      }
    }

    // Check if max retries exceeded
    if (job.attempts >= job.maxRetries) {
      await invoiceQueue.moveToDLQ(job, `Exceeded max retries (${job.maxRetries}). Error: ${errorMsg}`);
      await prisma.invoice.update({
        where: { id: job.data.dbInvoiceId },
        data: { status: 'REJECTED' }
      }).catch(() => {});
      await writeProblemBackToSourceErp(job, errorMsg);
      dispatchMerchantWebhook(job.tenantId, job.data.dbInvoiceId, 'invoice.rejected').catch(()=>{});
      // Surface reason in hub — create ValidationError so Validation Errors tab + Invoices REJECTED filter shows why
      try {
        await prisma.validationError.create({
          data: {
            tenantId: job.tenantId,
            clientInvoiceNumber: job.data.clientInvoiceNumber,
            errorCategory: errorMsg.includes('Gateway') || errorMsg.includes('CittaEFS') ? 'GATEWAY_REJECTED' : 'TRANSMIT_FAILED',
            fieldAffected: 'gateway',
            errorMessage: `After ${job.maxRetries} attempts: ${formatGatewayErrorMessage(errorMsg, {
              invoiceType: job.data.invoiceType,
              invoiceTypeCode: (job.data as any).invoiceTypeCode,
            })}`.slice(0, 4000),
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
// Only one batch runs at a time. Two overlapping batches could both pick up
// the same QUEUED job and submit it to CittaEFS twice. A call that arrives
// while a batch is running asks for one more pass and shares its promise.
let activeBatch: Promise<ProcessingResult[]> | null = null;
let rerunRequested = false;

export function runWorkerBatch(): Promise<ProcessingResult[]> {
  if (activeBatch) {
    rerunRequested = true;
    return activeBatch;
  }
  activeBatch = (async () => {
    const all: ProcessingResult[] = [];
    try {
      do {
        rerunRequested = false;
        all.push(...(await runWorkerBatchOnce()));
      } while (rerunRequested);
    } finally {
      activeBatch = null;
    }
    return all;
  })();
  return activeBatch;
}

async function runWorkerBatchOnce(): Promise<ProcessingResult[]> {
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
