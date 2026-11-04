import { Router } from "express";
import { prisma } from "../lib/prisma";
import { generateSha256, safeAuditLogCreate } from "../lib/serverHelpers";
import { runPagedSync } from "../connectors";
import {
  connectOdoo,
  getValidOdooCredentials,
  fetchOdooCompanyInfo,
  fetchOdooInvoicePage,
  ingestOdooInvoice,
} from "../services/odooService";

const router = Router();

// Odoo ERP — connect (form-based: url, database, username, api key)
router.post("/api/integrations/odoo/connect", async (req: any, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole && !["ADMIN", "INTEGRATION_MANAGER"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Forbidden: Requires ADMIN or INTEGRATION_MANAGER role" });
    }

    const tenantId = req.body?.tenantId || req.user?.tenantId || (req.query.tenantId as string) || "tenant_qbo_smb";
    const { odooUrl, odooDatabase, odooUsername, odooApiKey } = req.body || {};

    if (!odooUrl || !odooDatabase || !odooUsername || !odooApiKey) {
      return res.status(400).json({ success: false, error: "odooUrl, odooDatabase, odooUsername, and odooApiKey are all required" });
    }

    // Fail with a clear message instead of a raw FK-constraint crash when
    // tenantId doesn't resolve to a real row — happens when the frontend is
    // holding a stale tenant (e.g. cached from before a database switch), or
    // when none of the candidates above (body, JWT, query, the last-resort
    // default) resolve to a tenant that actually exists here.
    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenantExists) {
      return res.status(404).json({ success: false, error: `Tenant "${tenantId}" not found — refresh the page and re-select the client before connecting Odoo.` });
    }

    const result = await connectOdoo(tenantId, { odooUrl, odooDatabase, odooUsername, odooApiKey });

    await safeAuditLogCreate(prisma, {
      tenantId,
      action: "CONNECTOR_AUTHENTICATED",
      entityType: "INTEGRATION",
      entityRef: odooDatabase,
      details: `Odoo ERP connected successfully for database ${odooDatabase}`,
      sha256PayloadHash: generateSha256(String(odooDatabase)),
      performedBy: req.user?.email || "Odoo Connect",
      rawJson: { sourceSystem: "ODOO", odooDatabase, odooUrl },
    });

    res.json({ success: true, connected: result.connected, uid: result.uid });
  } catch (e: any) {
    console.error("[API Error] POST /api/integrations/odoo/connect failed:", e.message);
    res.status(400).json({ success: false, error: e.message });
  }
});

// Odoo ERP — status
router.get("/api/integrations/odoo/status", async (req: any, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.user?.tenantId || "tenant_qbo_smb";
    const integration = await prisma.integration.findFirst({
      where: { tenantId, sourceSystem: "ODOO" },
    });

    if (!integration) {
      return res.json({ connected: false, status: "DISCONNECTED", database: null });
    }

    res.json({
      connected: integration.status === "CONNECTED",
      status: integration.status,
      database: integration.companyId,
      lastSyncAt: integration.lastSyncAt,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Odoo ERP — sync (historical on first run, incremental thereafter)
router.post("/api/integrations/odoo/sync", async (req: any, res) => {
  try {
    const userRole = req.user?.role;
    const requestedTenantId = req.body?.tenantId || (req.query.tenantId as string) || req.user?.tenantId || "tenant_qbo_smb";
    if (req.user && req.user.role !== "ADMIN" && requestedTenantId !== req.user.tenantId) {
      return res.status(403).json({ success: false, error: "Forbidden: tenant isolation — can only sync own tenant" });
    }
    if (req.user && userRole !== "ADMIN" && userRole !== "INTEGRATION_MANAGER" && userRole !== "OPERATOR") {
      return res.status(403).json({ success: false, error: "Forbidden: Admin, Integration Manager or Operator role required" });
    }

    const tenantId = requestedTenantId;
    const integration = await prisma.integration.findFirst({
      where: { tenantId, sourceSystem: "ODOO" },
    });

    const result = await runPagedSync<any, number>({
      tenantId,
      sourceSystem: "ODOO",
      platformLabel: "Odoo ERP",
      auditAction: "ODOO_SYNC",
      performedBy: req.user?.email || "Sync Operator",
      fetchPage: (cursor) =>
        fetchOdooInvoicePage(tenantId, cursor, { since: integration?.lastSyncAt }),
      // ingestOdooInvoice dedupes on account.move.name.
      dedupeKey: (raw) => String(raw.name || raw.id),
      ingest: (raw) => ingestOdooInvoice(tenantId, raw),
      onRecordError: ({ key, error }) =>
        console.warn(`[Odoo Sync Warning] Skipped invoice ${key}: ${error.message}`),
    });

    res.json({
      success: true,
      totalFound: result.totalFound,
      newSynced: result.newSynced,
      alreadySynced: result.alreadySynced,
      count: result.processed.length,
      invoices: result.processed,
      skipped: result.errors.length,
    });
  } catch (e: any) {
    console.error("[API Error] POST /api/integrations/odoo/sync failed:", e.message);

    const isReauthNeeded = e.message?.toLowerCase().includes("reauthorization");
    if (isReauthNeeded) {
      const tenantId = req.body?.tenantId || (req.query.tenantId as string) || req.user?.tenantId || "tenant_qbo_smb";
      await prisma.integration.updateMany({
        where: { tenantId, sourceSystem: "ODOO" },
        data: { status: "DISCONNECTED" },
      }).catch(() => {});

      return res.status(401).json({
        success: false,
        reauthRequired: true,
        error: "Odoo connection needs reauthorization. Please reconnect Odoo ERP.",
      });
    }

    res.status(500).json({ success: false, error: e.message });
  }
});

// Connectors — Odoo live connectivity test
router.post("/api/connectors/odoo/test-live", async (req: any, res) => {
  const tenantId = req.body?.tenantId || req.user?.tenantId || (req.query.tenantId as string) || "tenant_qbo_smb";
  const start = Date.now();
  try {
    const companyInfo = await fetchOdooCompanyInfo(tenantId);
    const latencyMs = Date.now() - start;
    res.json({
      success: true,
      platform: "Odoo ERP",
      latencyMs,
      status: "HTTP 200 OK",
      authStatus: "AUTHENTICATED",
      companyInfo: {
        CompanyName: companyInfo?.name || "Unknown",
        Currency: Array.isArray(companyInfo?.currency_id) ? companyInfo.currency_id[1] : "N/A",
      },
    });
  } catch (e: any) {
    res.json({ success: false, error: e.message, latencyMs: Date.now() - start });
  }
});

export default router;
