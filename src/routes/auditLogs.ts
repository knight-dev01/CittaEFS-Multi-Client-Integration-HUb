import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getScopedTenantWhere, parsePagination } from "../lib/serverHelpers";

const router = Router();

// `rawJson` is never selected. It stores the full record that was written —
// for TENANT_ONBOARDED that includes cittaApiKey — so returning it would hand
// every reader the shared gateway secret. The columns below are the audit
// trail itself: who did what, to which record, and the hash proving it.
const AUDIT_COLUMNS = {
  id: true,
  tenantId: true,
  action: true,
  entityType: true,
  entityRef: true,
  details: true,
  sha256PayloadHash: true,
  performedBy: true,
  createdAt: true,
} as const;

// GET /api/audit-logs?tenantId=&action=&entityType=&q=&since=&page=&limit=
router.get("/api/audit-logs", async (req: any, res) => {
  try {
    const scoped = getScopedTenantWhere(req, req.query.tenantId as string | undefined);
    const where: any = { ...scoped };

    const action = String(req.query.action || "").trim();
    if (action) where.action = action;

    const entityType = String(req.query.entityType || "").trim();
    if (entityType) where.entityType = entityType;

    const search = String(req.query.q || "").trim();
    if (search) {
      where.OR = [
        { entityRef: { contains: search, mode: "insensitive" } },
        { details: { contains: search, mode: "insensitive" } },
        { performedBy: { contains: search, mode: "insensitive" } },
      ];
    }

    if (req.query.since) {
      const since = new Date(String(req.query.since));
      if (!Number.isNaN(since.getTime())) where.createdAt = { gte: since };
    }

    const { skip, take, page, limit } = parsePagination(req);
    const filter = Object.keys(where).length ? where : undefined;

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: filter,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: AUDIT_COLUMNS,
      }),
      prisma.auditLog.count({ where: filter }),
    ]);

    res.json({
      data: rows.map((row: any) => ({
        ...row,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e: any) {
    console.error("[API Error] GET /api/audit-logs failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /api/audit-logs/actions — distinct actions present in scope, so the UI
// filter only offers what this deployment has actually recorded.
router.get("/api/audit-logs/actions", async (req: any, res) => {
  try {
    const scoped = getScopedTenantWhere(req, req.query.tenantId as string | undefined);
    const rows = await prisma.auditLog.findMany({
      where: Object.keys(scoped).length ? scoped : undefined,
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    });
    res.json(rows.map((row: any) => row.action));
  } catch (e: any) {
    console.error("[API Error] GET /api/audit-logs/actions failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
