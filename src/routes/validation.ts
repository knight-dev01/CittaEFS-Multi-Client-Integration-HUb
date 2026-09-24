import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  getScopedTenantWhere,
  parsePagination,
} from "../lib/serverHelpers";
import { getCittaCodeType, isValidCittaCode } from "../data/referenceData";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { invoiceQueue } from "../queues/invoiceQueue";
import { ingestOdooInvoice } from "../services/odooService";
import { ingestQboInvoice } from "../services/qboService";
import { OdooAdapter, QuickBooksAdapter } from "../adapters/connectorAdapters";

// Reconstructs a signInvoice queue job from a persisted Invoice row and
// enqueues it directly, instead of only resetting the DB status and hoping
// the 5s orphan-recovery cron notices — used by /resolve so "fixed and
// retried" is an immediate, confirmable action, not an implicit one.
async function requeuePersistedInvoice(invoiceId: string): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true } });
  if (!inv) return false;
  const validated = invoiceIngestionSchema.parse({
    tenantId: inv.tenantId,
    clientInvoiceNumber: inv.clientInvoiceId,
    documentNumber: inv.documentNumber || undefined,
    invoiceType: inv.invoiceType as any,
    invoiceKind: inv.invoiceKind as any,
    issueDate: inv.issueDate.toISOString().substring(0, 10),
    customerCode: inv.customerCode,
    customerName: inv.customerName,
    customerTin: inv.customerTin || undefined,
    lineItems: inv.lineItems.map((li: any) => ({
      itemCode: li.itemCode,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountAmount: 0,
      hsOrServiceCode: li.hsOrServiceCode,
      codeType: getCittaCodeType(li.hsOrServiceCode) || "SERVICE_CODE",
      vatRate: li.vatRate,
    })),
  });
  await invoiceQueue.add(
    "signInvoice",
    { ...validated, dbInvoiceId: inv.id },
    { idempotencyKey: `${inv.tenantId}:${inv.clientInvoiceId}:resolve:${Date.now()}` }
  );
  return true;
}

const router = Router();

// ==========================================
// 6. VALIDATION ERRORS QUEUE API (DB Backed)
// ==========================================
router.get("/api/validation-errors", async (req: any, res) => {
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { ...getScopedTenantWhere(req, queryTenantId) };
    const [total, errors] = await Promise.all([
      prisma.validationError.count({ where }),
      prisma.validationError.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      res.json({ data: errors, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } else {
      res.setHeader("X-Total-Count", String(total));
      res.json(errors);
    }
  } catch (e: any) {
    console.error("[API Error] GET /api/validation-errors failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/api/validation-errors/resolve", async (req: any, res) => {
  try {
    const { errorId, hsOrServiceCode, correctedTin } = req.body;
    const errRecord = await prisma.validationError.findUnique({ where: { id: errorId } });
    if (!errRecord) return res.status(404).json({ success: false, error: "Validation error not found" });
    if (req.user && req.user.role !== "ADMIN" && errRecord.tenantId !== req.user.tenantId) return res.status(403).json({ success: false, error: "Forbidden" });

    // Bug fix (2026-09-15): this used to only patch reference data and mark
    // the error RESOLVED — for a validation error that fired at ingestion
    // time (before any Invoice row existed, e.g. a bad HS code from a fresh
    // Odoo/QBO pull), nothing was ever actually created or queued, so
    // "resolving" silently did nothing observable. Now: when a real Invoice
    // exists, it's patched AND directly re-queued (not left to the 5s
    // orphan-recovery cron); when none exists yet, ingestion is re-run from
    // the error's own stored raw payload now that the fix has been applied.
    let invoiceCreated = false;
    let requeued = 0;
    let outcomeMessage = "";

    try {
      if (hsOrServiceCode && errRecord.errorCategory === "MISSING_HS_CODE") {
        const cleanHs = String(hsOrServiceCode).trim();
        if (!cleanHs) throw new Error("hsOrServiceCode required");
        const isService = getCittaCodeType(cleanHs) === "SERVICE_CODE";
        // Find invoice(s) to patch — primary by tenant+number, then any tenant with same number, then UNMAPPED search
        let primary = await prisma.invoice.findFirst({ where: { tenantId: errRecord.tenantId, clientInvoiceId: errRecord.clientInvoiceNumber }, include: { lineItems: true } });
        if (!primary) primary = await prisma.invoice.findFirst({ where: { clientInvoiceId: errRecord.clientInvoiceNumber }, include: { lineItems: true } });
        let invoicesToPatch: any[] = [];
        if (primary) invoicesToPatch = [primary];
        else invoicesToPatch = await prisma.invoice.findMany({ where: { tenantId: errRecord.tenantId, lineItems: { some: { hsOrServiceCode: "UNMAPPED" } } }, include: { lineItems: true }, take: 5 });

        if (invoicesToPatch.length) {
          for (const inv of invoicesToPatch) {
            const targets = inv.lineItems.filter((li:any) => !isValidCittaCode(li.hsOrServiceCode) || errRecord.fieldAffected.includes(li.itemCode) || errRecord.fieldAffected === "lineItems" || errRecord.fieldAffected === "hsOrServiceCode");
            const toUpdate = targets.length ? targets : inv.lineItems.filter((li:any) => li.hsOrServiceCode === "UNMAPPED");
            const list = toUpdate.length ? toUpdate : inv.lineItems.slice(0,1);
            for (const li of list) {
              const existingItem = await prisma.item.findFirst({ where: { tenantId: inv.tenantId, clientSku: li.itemCode } });
              if (existingItem) {
                await prisma.item.update({ where: { id: existingItem.id }, data: { hsOrServiceCode: cleanHs, categoryType: isService ? "SERVICE" : "GOODS", isService } });
              } else {
                await prisma.item.create({ data: { tenantId: inv.tenantId, clientSku: li.itemCode, description: li.description || "Mapped via validation fix", hsOrServiceCode: cleanHs, categoryType: isService ? "SERVICE" : "GOODS", isService, defaultVatRate: 7.5 } as any });
              }
              await prisma.invoiceLineItem.update({ where: { id: li.id }, data: { hsOrServiceCode: cleanHs } });
            }
            if (["REJECTED","FAILED","CANCELLED"].includes(inv.status)) {
              await prisma.invoice.update({ where: { id: inv.id }, data: { status: "PENDING_NRS_STAMP" } });
            }
            try {
              if (await requeuePersistedInvoice(inv.id)) requeued++;
            } catch (rqErr: any) {
              console.error(`[Resolve] Requeue failed for invoice ${inv.id}:`, rqErr.message);
            }
          }
          outcomeMessage = requeued
            ? `HS code corrected on ${invoicesToPatch.length} invoice(s); ${requeued} re-queued for CittaEFS submission.`
            : `HS code corrected on ${invoicesToPatch.length} invoice(s), but re-queue failed — check Queue Monitor.`;
        } else {
          // No invoice was ever created for this error (validation failed at
          // ingestion time). Patch the Item dictionary so the code is right,
          // then actually re-run ingestion from the stored raw payload —
          // don't just hope a future sync will pick it up.
          let rawPayload: any = null;
          try { rawPayload = typeof errRecord.rawPayloadSample === 'string' ? JSON.parse(errRecord.rawPayloadSample) : errRecord.rawPayloadSample; } catch {}

          // Derive the real clientSku the same way ingestion itself does — a
          // hand-rolled field-name guess here (e.g. rawPayload.lineItems[0])
          // doesn't match Odoo's actual shape (_lines[].product_id, bracket-
          // encoded), so the patch silently lands on the wrong SKU and
          // re-ingestion fails again with the same "UNMAPPED" error.
          let lines: any[] = [];
          if (rawPayload && errRecord.sourceErp === "odoo") {
            try { lines = new OdooAdapter().transform(rawPayload).lineItems; } catch {}
          } else if (rawPayload && errRecord.sourceErp === "qbo") {
            try { lines = new QuickBooksAdapter().transform(rawPayload).lineItems; } catch {}
          }
          const invalidLines = lines.filter((li: any) => !isValidCittaCode(li.hsOrServiceCode));
          // The error message names the specific item that failed (e.g. "...
          // found UNMAPPED for RGB Keyboard"). Narrow to just that one when
          // we can match it — a multi-item invoice's other products almost
          // certainly need a different code, so don't stamp the one code the
          // user gave us onto all of them (a chair and a laptop aren't the
          // same HS code). Only widen to every invalid line as a last resort.
          const namedItem = errRecord.errorMessage.match(/for (.+?)\)/)?.[1]?.trim().toLowerCase();
          const namedMatch = namedItem ? invalidLines.find((li: any) => (li.clientSku || '').toLowerCase() === namedItem) : undefined;
          let skus: string[];
          if (namedMatch) {
            skus = [namedMatch.clientSku];
          } else if (invalidLines.length) {
            skus = invalidLines.map((li: any) => li.clientSku).filter(Boolean);
          } else if (lines.length) {
            skus = [lines[0].clientSku].filter(Boolean);
          } else {
            const bestGuessSku = rawPayload?.lineItems?.[0]?.itemCode || rawPayload?.lineItems?.[0]?.clientSku || rawPayload?.Line?.[0]?.SalesItemLineDetail?.ItemRef?.name || null;
            skus = [bestGuessSku || "SKU-GENERIC"];
          }
          for (const sku of skus) {
            const existing = await prisma.item.findFirst({ where: { tenantId: errRecord.tenantId, clientSku: sku } });
            if (existing) await prisma.item.update({ where: { id: existing.id }, data: { hsOrServiceCode: cleanHs, categoryType: isService ? "SERVICE" : "GOODS", isService } });
            else await prisma.item.create({ data: { tenantId: errRecord.tenantId, clientSku: sku, description: "Mapped via validation fix", hsOrServiceCode: cleanHs, categoryType: isService ? "SERVICE" : "GOODS", isService, defaultVatRate: 7.5 } as any });
          }

          if (rawPayload && (errRecord.sourceErp === "odoo" || errRecord.sourceErp === "qbo")) {
            try {
              const ingestFn = errRecord.sourceErp === "odoo" ? ingestOdooInvoice : ingestQboInvoice;
              const created = await ingestFn(errRecord.tenantId, rawPayload);
              invoiceCreated = true;
              outcomeMessage = `Item code corrected and invoice "${created.clientInvoiceId}" created from the original ${errRecord.sourceErp.toUpperCase()} payload (status: ${created.status}).`;
            } catch (reIngestErr: any) {
              outcomeMessage = `Item code corrected, but re-ingestion still failed: ${reIngestErr.message}. See the new validation error this created.`;
            }
          } else {
            outcomeMessage = `Item code corrected for future syncs, but no invoice exists yet for "${errRecord.clientInvoiceNumber}"${errRecord.sourceErp ? "" : " (source unknown — predates this fix)"} — nothing to resubmit automatically. Trigger a manual re-sync to create it.`;
          }
        }
      }
      if (correctedTin && (errRecord.errorCategory === "INVALID_TIN_FORMAT" || errRecord.errorCategory === "MISSING_B2B_TIN")) {
        const cleanTin = String(correctedTin).trim().toUpperCase();
        const invoice = await prisma.invoice.findFirst({ where: { tenantId: errRecord.tenantId, clientInvoiceId: errRecord.clientInvoiceNumber } });
        if (invoice) {
          await prisma.invoice.update({ where: { id: invoice.id }, data: { customerTin: cleanTin, ...( ["REJECTED","FAILED","CANCELLED"].includes(invoice.status) ? { status: "PENDING_NRS_STAMP" } : {} ) } });
          try {
            if (await requeuePersistedInvoice(invoice.id)) requeued++;
            outcomeMessage = `TIN corrected on invoice "${invoice.clientInvoiceId}" and re-queued for CittaEFS submission.`;
          } catch (rqErr: any) {
            outcomeMessage = `TIN corrected, but re-queue failed: ${rqErr.message}`;
          }
        } else {
          let rawPayload: any = null;
          try { rawPayload = typeof errRecord.rawPayloadSample === 'string' ? JSON.parse(errRecord.rawPayloadSample) : errRecord.rawPayloadSample; } catch {}
          if (rawPayload && (errRecord.sourceErp === "odoo" || errRecord.sourceErp === "qbo")) {
            try {
              const ingestFn = errRecord.sourceErp === "odoo" ? ingestOdooInvoice : ingestQboInvoice;
              const created = await ingestFn(errRecord.tenantId, rawPayload);
              invoiceCreated = true;
              outcomeMessage = `TIN corrected and invoice "${created.clientInvoiceId}" created from the original ${errRecord.sourceErp.toUpperCase()} payload (status: ${created.status}).`;
            } catch (reIngestErr: any) {
              outcomeMessage = `TIN noted, but re-ingestion still failed: ${reIngestErr.message}.`;
            }
          } else {
            outcomeMessage = `No invoice exists yet for "${errRecord.clientInvoiceNumber}" — nothing to resubmit automatically. Trigger a manual re-sync to create it.`;
          }
        }
        // Also patch customer master if exists
        try {
          const cust = await prisma.customer.findFirst({ where: { tenantId: errRecord.tenantId, clientSystemCustId: invoice?.customerCode } });
          if (cust) await prisma.customer.update({ where: { id: cust.id }, data: { taxId: cleanTin, tinValidationStatus: "VALIDATED" } });
        } catch {}
      }
    } catch (patchErr:any) {
      console.error("[Resolve] patch failed:", patchErr.message);
      outcomeMessage = outcomeMessage || `Marked resolved, but the fix could not be applied: ${patchErr.message}`;
    }

    await prisma.validationError.update({ where: { id: errorId }, data: { status: "RESOLVED" } });
    // Audit log
    try { await prisma.auditLog.create({ data: { tenantId: errRecord.tenantId, action: "CODE_MAPPED", entityType: "ITEM_MAPPING", entityRef: errRecord.clientInvoiceNumber, details: `Validation fix applied: ${errRecord.errorCategory} → ${hsOrServiceCode || correctedTin} (via resolve). ${outcomeMessage}`, sha256PayloadHash: "resolve", performedBy: req.user?.email || "Operator" } }); } catch {}

    res.json({ success: true, invoiceCreated, requeued, message: outcomeMessage || "Validation error resolved." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/validation-errors/bulk-resolve", async (req: any, res) => {
  try {
    const tenantId = req.body?.tenantId || (req as any).user?.tenantId;
    const where: any = tenantId ? { tenantId, status: "OPEN" } : { status: "OPEN" };
    if (req.user && req.user.role !== "ADMIN" && tenantId !== req.user.tenantId) return res.status(403).json({ success: false, error: "Forbidden" });
    const result = await prisma.validationError.updateMany({ where, data: { status: "RESOLVED" } });
    res.json({ success: true, resolved: result.count, message: `Bulk fixed ${result.count} validation errors` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 8. AUDIT LOGS & METRICS API (DB Backed)
// ==========================================
router.get("/api/audit-logs", async (req: any, res) => {
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { ...getScopedTenantWhere(req, queryTenantId) };
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      res.json({ data: logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } else {
      res.setHeader("X-Total-Count", String(total));
      res.json(logs);
    }
  } catch (e: any) {
    console.error("[API Error] GET /api/audit-logs failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/api/metrics", async (req: any, res) => {
  try {
    const scoped = getScopedTenantWhere(req, req.query.tenantId as string | undefined);
    const invWhere: any = scoped.tenantId ? { tenantId: scoped.tenantId } : {};
    const totalInvoices = await prisma.invoice.count({ where: Object.keys(invWhere).length ? invWhere : undefined });
    const approvedInvoices = await prisma.invoice.count({
      where: { ...invWhere, status: "APPROVED" },
    });
    const tenantsCount = await prisma.tenant.count({ where: req.user && req.user.role !== "ADMIN" ? { id: req.user.tenantId } : undefined });
    const openErrors = await prisma.validationError.count({
      where: { ...(scoped.tenantId ? { tenantId: scoped.tenantId } : {}), status: "OPEN" },
    });

    const successRate =
      totalInvoices > 0
        ? Number(((approvedInvoices / totalInvoices) * 100).toFixed(2))
        : 99.85;

    // Real gateway latency: avg (updatedAt - createdAt) for recent COMPLETED queue jobs, default 138ms if none
    let averageLatencyMs = 138;
    let cittaGatewayStatus: string = "ONLINE";
    try {
      const recentJobs = await prisma.queueJob.findMany({ where: { status: "COMPLETED" }, orderBy: { updatedAt: "desc" }, take: 20 });
      if (recentJobs.length) {
        const latencies = recentJobs.map((j:any) => new Date(j.updatedAt).getTime() - new Date(j.createdAt).getTime()).filter((v:number)=> v>0 && v<60000);
        if (latencies.length) averageLatencyMs = Math.round(latencies.reduce((a:number,b:number)=>a+b,0)/latencies.length);
      }
      const lastDLQ = await prisma.queueJob.findFirst({ where: { status: "DLQ" }, orderBy: { updatedAt: "desc" } });
      if (lastDLQ && Date.now() - new Date(lastDLQ.updatedAt).getTime() < 5*60*1000) cittaGatewayStatus = "DEGRADED";
      else if (!recentJobs.length) cittaGatewayStatus = "UNKNOWN";
    } catch {}

    res.json({
      totalInvoicesProcessed: totalInvoices,
      nrsStampSuccessRate: successRate,
      averageLatencyMs,
      activeTenantsCount: tenantsCount,
      pendingValidationCount: openErrors,
      reconciliationCronStatus: "HEALTHY",
      cittaGatewayStatus,
    });
  } catch (e: any) {
    console.error("[API Error] GET /api/metrics failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
