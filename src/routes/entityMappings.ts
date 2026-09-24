import { Router } from "express";
import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";
import {
  getScopedTenantWhere,
  canAccessTenant,
  parsePagination,
} from "../lib/serverHelpers";
import { confirmEntityMappingRegistration } from "../services/entityMappingService";

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

    const { mapping: updated, requeued } = await confirmEntityMappingRegistration(
      prisma,
      mapping,
      cittaReferenceCode,
      req.user?.email || "Operator"
    );

    res.json({ success: true, mapping: updated, requeued });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
