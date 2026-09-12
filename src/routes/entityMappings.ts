import { Router } from "express";
import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";
import {
  generateSha256,
  safeAuditLogCreate,
  getScopedTenantWhere,
  canAccessTenant,
  parsePagination,
} from "../lib/serverHelpers";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { invoiceQueue } from "../queues/invoiceQueue";
import { getCittaCodeType } from "../data/referenceData";

const router = Router();

// ==========================================
// ENTITY MAPPINGS API — CittaEFS customer/item registration tracking
// (thin-hub pivot, see docs/CittaHub_Revision_Plan.md Phase 3)
// ==========================================

router.get("/api/entity-mappings", async (req: any, res) => {
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const status = req.query.status as string | undefined;
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { ...getScopedTenantWhere(req, queryTenantId) };
    if (entityType) where.entityType = entityType;
    if (status && status !== "ALL") where.status = status;
    const [total, rows] = await Promise.all([
      prisma.entityMapping.count({ where }),
      prisma.entityMapping.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    ]);
    res.json({ data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Generates the exact CittaEFS bulk-upload template (Customer Template / Item
// Template — column order/headers per CittaHub_Section_E_Spec-5.xlsx's
// Customer Columns / Item Columns sheets), pre-filled with everything the Hub
// knows about entities awaiting registration. Staff download this, upload it
// through EFS's own portal (no registration API exists), then confirm back
// via POST /:id/confirm.
router.get("/api/entity-mappings/:tenantId/export", async (req: any, res) => {
  try {
    const { tenantId } = req.params;
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation" });
    const entityType = ((req.query.entityType as string) || "CUSTOMER").toUpperCase();
    const pending = await prisma.entityMapping.findMany({
      where: { tenantId, entityType, status: "PENDING_REGISTRATION" },
      orderBy: { createdAt: "asc" },
    });

    let header: string[];
    let sheetName: string;
    let rows: any[][];

    if (entityType === "ITEM") {
      // Item Columns sheet: sheet-name check is not strict for items (unlike
      // Customer's exact "Customer Template" requirement), so "Item Template" is safe.
      const legacyItems = await prisma.item.findMany({ where: { tenantId } });
      header = ["ItemCode", "ItemName", "ItemDescription", "Unit Code", "HsorServiceCode"];
      sheetName = "Item Template";
      rows = pending.map((m) => {
        const legacy = legacyItems.find((i) => i.clientSku === m.sourceErpId);
        return [
          m.sourceErpId,
          m.displayName || m.sourceErpId,
          legacy?.description || "",
          legacy?.unitCode || "EA",
          legacy?.hsOrServiceCode || "",
        ];
      });
    } else {
      // Customer sheet: sheet name must be exactly "Customer Template" (case-sensitive).
      const legacyCustomers = await prisma.customer.findMany({ where: { tenantId } });
      header = [
        "CustomerCode",
        "CustomerName",
        "CustomerTIN",
        "CustomerEmail",
        "CCEmail (optional) (seperate with;)",
        "StreetName",
        "CityName",
        "Country",
      ];
      sheetName = "Customer Template";
      rows = pending.map((m) => {
        const legacy = legacyCustomers.find((c) => c.clientSystemCustId === m.sourceErpId);
        return [
          m.sourceErpId,
          m.displayName || m.sourceErpId,
          m.tin || legacy?.taxId || "",
          legacy?.email || "",
          legacy?.ccEmail || "",
          legacy?.street || "",
          legacy?.city || "",
          legacy?.country || "NG",
        ];
      });
    }

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="CittaEFS_${entityType}_Registration_${tenantId}.xlsx"`);
    res.send(buffer);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Staff completed registration in EFS's own portal and are entering the
// CittaEFS-issued reference code back into the Hub. Marks the mapping MAPPED
// and re-enqueues any invoices that were stuck on it (customer mappings only —
// item registration isn't gated, see Phase 2).
router.post("/api/entity-mappings/:id/confirm", async (req: any, res) => {
  try {
    const { id } = req.params;
    const { cittaReferenceCode } = req.body || {};
    if (!cittaReferenceCode || typeof cittaReferenceCode !== "string" || !cittaReferenceCode.trim()) {
      return res.status(400).json({ success: false, error: "cittaReferenceCode is required" });
    }
    const mapping = await prisma.entityMapping.findUnique({ where: { id } });
    if (!mapping) return res.status(404).json({ success: false, error: "Entity mapping not found" });
    if (!canAccessTenant(req, mapping.tenantId)) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation" });

    const refCode = cittaReferenceCode.trim();
    const updated = await prisma.entityMapping.update({
      where: { id },
      data: { status: "MAPPED", cittaReferenceCode: refCode },
    });

    let requeued = 0;
    if (mapping.entityType === "CUSTOMER") {
      const stuck = await prisma.invoice.findMany({
        where: { tenantId: mapping.tenantId, customerCode: mapping.sourceErpId, status: "NEEDS_EFS_REGISTRATION" },
        include: { lineItems: true },
      });
      for (const inv of stuck) {
        try {
          await prisma.invoice.update({ where: { id: inv.id }, data: { status: "PENDING_NRS_STAMP" } });
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
            { idempotencyKey: `${inv.tenantId}:${inv.clientInvoiceId}:registered:${Date.now()}` }
          );
          requeued++;
        } catch (e: any) {
          console.error(`[EntityMapping Confirm] Failed to requeue invoice ${inv.id}:`, e.message);
        }
      }
    }

    await safeAuditLogCreate(prisma, {
      tenantId: mapping.tenantId,
      action: "ENTITY_REGISTERED",
      entityType: mapping.entityType,
      entityRef: mapping.sourceErpId,
      details: `Confirmed CittaEFS registration for ${mapping.entityType.toLowerCase()} ${mapping.sourceErpId} (reference ${refCode}). Requeued ${requeued} invoice(s).`,
      sha256PayloadHash: generateSha256(`${mapping.id}:${refCode}`),
      performedBy: req.user?.email || "Operator",
    });

    res.json({ success: true, mapping: updated, requeued });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
