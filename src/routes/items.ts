import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  getScopedTenantWhere,
  parsePagination,
} from "../lib/serverHelpers";
import { isValidCittaCode, getCittaCodeType } from "../data/referenceData";

// Real CittaEFS/NRS codes — bare numeric, no "HS-"/"SRV-" prefix. Only the few
// keyword matches we can be confident about get auto-classified; everything
// else is left UNMAPPED rather than silently guessing a wrong-but-valid code.
function inferCittaCode(sku: string, desc: string): string {
  const text = `${sku} ${desc}`.toLowerCase();
  if (/gardening|sod|rocks|fountain|pump|sprinkler|landscap/.test(text)) return "8130"; // Landscape care and maintenance service activities
  if ((sku || "").toUpperCase().startsWith("SRV")) return "6209"; // Other information technology and computer service activities
  if (/laptop|notebook|macbook|computer|desktop|router|switch|\bserver\b/.test(text)) return "8471.30"; // Automatic data processing machines; portable
  return "UNMAPPED";
}

const router = Router();

router.get("/api/items/mappings", async (req: any, res) => {
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { ...getScopedTenantWhere(req, queryTenantId) };
    const [total, rawItems] = await Promise.all([
      prisma.item.count({ where }),
      prisma.item.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    ]);
    // Item has no DB "status" column — the frontend expects MAPPED/UNMAPPED,
    // so compute it here from whether hsOrServiceCode is a real, currently-valid
    // code. Also fall back "name" to description/clientSku — auto-ingestion
    // (QBO/Odoo sync) has always only populated description, leaving name null.
    const items = rawItems.map((it: any) => ({
      ...it,
      name: it.name || it.description || it.clientSku,
      status: isValidCittaCode(it.hsOrServiceCode) ? "MAPPED" : "UNMAPPED",
    }));
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      res.json({ data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } else {
      res.setHeader("X-Total-Count", String(total));
      res.json(items);
    }
  } catch (e: any) {
    console.error("[API Error] GET /api/items/mappings failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/api/items/mappings", async (req, res) => {
  return res.status(403).json({ success: false, error: "Items are ERP-sourced and immutable in hub — edit in ERP (QBO/Odoo) and sync will re-ingest (only ValidationError resolve may patch hsOrServiceCode)" });
  try {
    const {
      tenantId,
      clientSku,
      name,
      description,
      unitCode,
      hsOrServiceCode,
      defaultVatRate,
    } = req.body;
    const tId = tenantId || "tenant_qbo_smb";
    const sku = clientSku || "SKU-NEW";
    const resolvedCode = hsOrServiceCode || "UNMAPPED";
    const isService = getCittaCodeType(resolvedCode) === "SERVICE_CODE";

    let item: any;
    const existing = await prisma.item.findFirst({
      where: { tenantId: tId, clientSku: sku },
    });
    const owningTenant = await prisma.tenant.findUnique({
      where: { id: tId },
    });

    if (existing) {
      const nextCode = hsOrServiceCode || existing.hsOrServiceCode;
      item = await prisma.item.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name,
          description: description || existing.description,
          unitCode: unitCode || existing.unitCode,
          hsOrServiceCode: nextCode,
          categoryType: getCittaCodeType(nextCode) === "SERVICE_CODE" ? "SERVICE" : "GOODS",
          isService: getCittaCodeType(nextCode) === "SERVICE_CODE",
          defaultVatRate:
            defaultVatRate !== undefined
              ? Number(defaultVatRate)
              : existing.defaultVatRate,
        },
      });
    } else {
      item = await prisma.item.create({
        data: {
          tenantId: tId,
          clientSku: sku,
          name: name || description || "Catalog Item",
          description: description || "Catalog Item",
          unitCode: unitCode || "EA",
          hsOrServiceCode: resolvedCode,
          categoryType: isService ? "SERVICE" : "GOODS",
          isService,
          defaultVatRate:
            defaultVatRate !== undefined
              ? Number(defaultVatRate)
              : (owningTenant?.defaultVatRate ?? 7.5),
        },
      });
    }

    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/items/mappings/auto-map", async (req, res) => {
  return res.status(403).json({ success: false, error: "Items are ERP-sourced and immutable — fix in ERP or via ValidationError resolve" });
  try {
    const { tenantId } = req.body;
    let mappedCount = 0;
    let stillUnmappedCount = 0;
    const unmapped = await prisma.item.findMany({
      where: {
        tenantId: tenantId || undefined,
        hsOrServiceCode: "UNMAPPED",
      },
    });

    for (const item of unmapped) {
      const inferred = inferCittaCode(item.clientSku, item.description || item.name || "");
      if (!isValidCittaCode(inferred)) {
        stillUnmappedCount++;
        continue;
      }
      await prisma.item.update({
        where: { id: item.id },
        data: {
          hsOrServiceCode: inferred,
          categoryType: inferred === "6209" || inferred === "8130" ? "SERVICE" : "GOODS",
        },
      });
      mappedCount++;
    }

    res.json({ success: true, mappedCount, stillUnmappedCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/items/mappings/:id", async (req: any, res) => {
  return res.status(403).json({ success: false, error: "Items are ERP-sourced and immutable in hub — edit in ERP (QBO/Odoo)" });
  try {
    const { id } = req.params;
    const { name, description, unitCode, hsOrServiceCode, defaultVatRate, categoryType } = req.body;
    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "Item not found" });
    const updated = await prisma.item.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        description: description ?? existing.description,
        unitCode: unitCode ?? existing.unitCode,
        hsOrServiceCode: hsOrServiceCode ?? existing.hsOrServiceCode,
        categoryType: categoryType ?? existing.categoryType,
        defaultVatRate: defaultVatRate !== undefined ? Number(defaultVatRate) : existing.defaultVatRate,
      },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/items/mappings/:id", async (req: any, res) => {
  return res.status(403).json({ success: false, error: "Items are ERP-sourced and immutable in hub — delete in ERP" });
  try {
    await prisma.item.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "Item not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
