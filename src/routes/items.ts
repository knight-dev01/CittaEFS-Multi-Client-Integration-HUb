import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  getScopedTenantWhere,
  parsePagination,
} from "../lib/serverHelpers";

const router = Router();

router.get("/api/items/mappings", async (req: any, res) => {
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { ...getScopedTenantWhere(req, queryTenantId) };
    const [total, items] = await Promise.all([
      prisma.item.count({ where }),
      prisma.item.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    ]);
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

    let item: any;
    const existing = await prisma.item.findFirst({
      where: { tenantId: tId, clientSku: sku },
    });
    const owningTenant = await prisma.tenant.findUnique({
      where: { id: tId },
    });

    if (existing) {
      item = await prisma.item.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name,
          description: description || existing.description,
          unitCode: unitCode || existing.unitCode,
          hsOrServiceCode: hsOrServiceCode || existing.hsOrServiceCode,
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
          hsOrServiceCode: hsOrServiceCode || "HS-8471.30",
          categoryType: "GOODS",
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
  try {
    const { tenantId } = req.body;
    let mappedCount = 0;
    const unmapped = await prisma.item.findMany({
      where: {
        tenantId: tenantId || undefined,
        hsOrServiceCode: "UNMAPPED",
      },
    });

    for (const item of unmapped) {
      await prisma.item.update({
        where: { id: item.id },
        data: {
          hsOrServiceCode: "HS-3926.90",
          categoryType: "GOODS",
        },
      });
    }
    mappedCount = unmapped.length;

    res.json({ success: true, mappedCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/items/mappings/:id", async (req: any, res) => {
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
  try {
    await prisma.item.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "Item not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
