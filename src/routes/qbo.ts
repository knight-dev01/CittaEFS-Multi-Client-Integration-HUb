import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  generateSha256,
  safeAuditLogCreate,
  renderOAuthBridgeHtml,
} from "../lib/serverHelpers";
import { createOAuthConnectionRouter, runPagedSync } from "../connectors";
import {
  fetchQboInvoices,
  fetchQboInvoicePage,
  fetchQboCompanyInfo,
  ingestQboInvoice,
  writebackProblemToQbo,
  getTenantQboEnvironment,
  getQboCredentialsForEnvironment,
  QBO_OAUTH_PROVIDER,
  QboEnvironment,
} from "../services/qboService";

const router = Router();

// Connect + callback are the shared OAuth route factory. QBO supplies its
// endpoints, how to pick sandbox/production credentials, and realmId handling.
router.use(
  createOAuthConnectionRouter({
    platformKey: "qbo",
    sourceSystem: "QUICKBOOKS_ONLINE",
    platformLabel: "QuickBooks Online",
    provider: QBO_OAUTH_PROVIDER,
    resolveTenantId: (req) =>
      (req.query.tenantId as string) || req.user?.tenantId || "tenant_qbo_smb",
    getRedirectUri: () => process.env.QBO_REDIRECT_URI || "",
    buildState: async (_req, tenantId) => ({
      environment: await getTenantQboEnvironment(tenantId),
    }),
    getCredentials: async (tenantId, state) => {
      const environment: QboEnvironment =
        state?.environment === "production"
          ? "production"
          : state?.environment === "sandbox"
            ? "sandbox"
            : await getTenantQboEnvironment(tenantId);
      return {
        ...getQboCredentialsForEnvironment(environment),
        redirectUri: process.env.QBO_REDIRECT_URI || "",
      };
    },
    extractCompanyId: (req) =>
      typeof req.query.realmId === "string" ? req.query.realmId : undefined,
    onConnected: async ({ tenantId, state }) => {
      // Persist the environment this grant was issued under, so later token
      // refreshes and API calls pick the matching credentials and base URL.
      try {
        const tenantRow = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { erpConfig: true },
        });
        let cfg: any = {};
        try {
          cfg = tenantRow?.erpConfig ? JSON.parse(tenantRow.erpConfig) : {};
        } catch {}
        cfg.environment = state?.environment === "production" ? "production" : "sandbox";
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { erpConfig: JSON.stringify(cfg) },
        });
      } catch (e: any) {
        console.warn(
          `[QBO Callback] Failed to persist environment for tenant ${tenantId}:`,
          e.message,
        );
      }
    },
    successQuery: ({ tenantId, companyId }) =>
      `qbo=success&tenantId=${encodeURIComponent(tenantId)}&realmId=${encodeURIComponent(companyId || "")}`,
    renderBridge: (payload) =>
      renderOAuthBridgeHtml({
        success: payload.success,
        tenantId: payload.tenantId,
        realmId: payload.companyId,
        error: payload.error,
        redirectQs: payload.redirectQs,
      }),
  }),
);

// QuickBooks Online — switch sandbox/production for this tenant. A single
// Intuit app issues separate credentials per environment, so sandbox tokens
// never work against production (or vice versa) — if this tenant already has
// a QBO integration, flip it to NEEDS_REAUTH so the UI's existing "Connect"
// flow naturally prompts a fresh OAuth grant under the new environment.
router.post("/api/integrations/qbo/environment", async (req: any, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole && !["ADMIN", "INTEGRATION_MANAGER"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Forbidden: Requires ADMIN or INTEGRATION_MANAGER role" });
    }
    const tenantId = req.body?.tenantId || req.user?.tenantId || (req.query.tenantId as string) || "tenant_qbo_smb";
    const environment: QboEnvironment = req.body?.environment === "production" ? "production" : "sandbox";

    const current = await getTenantQboEnvironment(tenantId);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { erpConfig: true } });
    if (!tenant) return res.status(404).json({ success: false, error: "Tenant not found" });

    let cfg: any = {};
    try { cfg = tenant.erpConfig ? JSON.parse(tenant.erpConfig) : {}; } catch {}
    cfg.environment = environment;
    await prisma.tenant.update({ where: { id: tenantId }, data: { erpConfig: JSON.stringify(cfg) } });

    let reauthRequired = false;
    if (environment !== current) {
      const result = await prisma.integration.updateMany({
        where: { tenantId, sourceSystem: "QUICKBOOKS_ONLINE", status: "CONNECTED" },
        data: { status: "NEEDS_REAUTH" },
      });
      reauthRequired = result.count > 0;
    }

    await safeAuditLogCreate(prisma, {
      tenantId,
      action: "QBO_ENVIRONMENT_SWITCHED",
      entityType: "INTEGRATION",
      entityRef: "QUICKBOOKS_ONLINE",
      details: `QBO environment switched ${current} → ${environment}.${reauthRequired ? " Existing connection flagged NEEDS_REAUTH." : ""}`,
      sha256PayloadHash: generateSha256(`${tenantId}:${environment}:${Date.now()}`),
      performedBy: req.user?.email || "Operator",
    });

    res.json({ success: true, environment, reauthRequired });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// QuickBooks Online — status
router.get("/api/integrations/qbo/status", async (req: any, res) => {
  try {
    const tenantId =
      (req.query.tenantId as string) ||
      req.user?.tenantId ||
      "tenant_qbo_smb";
    const integration = await prisma.integration.findFirst({
      where: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
      },
    });

    const environment = await getTenantQboEnvironment(tenantId);

    if (!integration) {
      return res.json({
        connected: false,
        status: "DISCONNECTED",
        companyId: null,
        environment,
      });
    }

    res.json({
      connected: integration.status === "CONNECTED",
      status: integration.status,
      companyId: integration.companyId,
      lastSyncAt: integration.lastSyncAt,
      environment,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// QuickBooks Online — historical sync
router.post("/api/integrations/qbo/sync", async (req: any, res) => {
  try {
    const userRole = req.user?.role;
    const requestedTenantId = req.body?.tenantId || (req.query.tenantId as string) || req.user?.tenantId || "tenant_qbo_smb";
    if (req.user && req.user.role !== "ADMIN" && requestedTenantId !== req.user.tenantId) {
      return res.status(403).json({ success: false, error: "Forbidden: tenant isolation — can only sync own tenant" });
    }
    if (
      req.user &&
      userRole !== "ADMIN" &&
      userRole !== "INTEGRATION_MANAGER" &&
      userRole !== "OPERATOR"
    ) {
      return res
        .status(403)
        .json({
          success: false,
          error: "Forbidden: Admin, Integration Manager or Operator role required",
        });
    }

    const tenantId = requestedTenantId;

    const result = await runPagedSync<any, number>({
      tenantId,
      sourceSystem: "QUICKBOOKS_ONLINE",
      platformLabel: "QuickBooks Online",
      auditAction: "QBO_HISTORICAL_SYNC",
      performedBy: req.user?.email || "Sync Operator",
      fetchPage: async (cursor) => {
        try {
          return await fetchQboInvoicePage(tenantId, cursor);
        } catch (fetchErr: any) {
          if (cursor !== null) throw fetchErr;
          console.warn(
            "[QBO Sync] Paginated fetch failed, trying standard fetch:",
            fetchErr,
          );
          const rows = await fetchQboInvoices(tenantId);
          return { records: rows, nextCursor: null };
        }
      },
      // ingestQboInvoice dedupes on DocNumber, so the pipeline must count on it too.
      dedupeKey: (raw) => String(raw.DocNumber || raw.Id),
      ingest: (raw) => ingestQboInvoice(tenantId, raw),
      onRecordError: ({ record, key, error }) => {
        console.warn(`[QBO Sync Warning] Skipped invoice ${key}: ${error.message}`);
        // Mirror the rejection into QuickBooks on the invoice's PrivateNote so
        // the client can fix it without leaving QBO. Best-effort: a failed
        // writeback must not stop the rest of the sync.
        writebackProblemToQbo(tenantId, String(record.Id), error.message).catch(
          (wbErr) =>
            console.warn(
              `[QBO Sync Warning] Could not write problem back for invoice ${key}: ${wbErr.message}`,
            ),
        );
      },
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
    console.error(
      "[API Error] POST /api/integrations/qbo/sync failed:",
      e.message,
    );

    const isReauthNeeded =
      e.message?.toLowerCase().includes("reauthorization") ||
      e.message?.includes("401");
    if (isReauthNeeded) {
      const tenantId =
        req.body?.tenantId ||
        (req.query.tenantId as string) ||
        req.user?.tenantId ||
        "tenant_qbo_smb";
      await prisma.integration
        .updateMany({
          where: { tenantId, sourceSystem: "QUICKBOOKS_ONLINE" },
          data: { status: "DISCONNECTED" },
        })
        .catch(() => {});

      return res.status(401).json({
        success: false,
        reauthRequired: true,
        error:
          "QuickBooks connection needs reauthorization. Please reconnect QuickBooks Online.",
        connectUrl: `/api/integrations/qbo/connect?tenantId=${tenantId}`,
      });
    }

    res.status(500).json({ success: false, error: e.message });
  }
});

// Connectors — QBO live connectivity test
router.post("/api/connectors/qbo/test-live", async (req: any, res) => {
  const tenantId = req.body?.tenantId || req.user?.tenantId || (req.query.tenantId as string) || "tenant_qbo_smb";
  const start = Date.now();
  try {
    const companyInfo = await fetchQboCompanyInfo(tenantId);
    const latencyMs = Date.now() - start;
    res.json({
      success: true,
      platform: "QuickBooks Online",
      environment: (await getTenantQboEnvironment(tenantId)).toUpperCase(),
      latencyMs,
      status: "HTTP 200 OK",
      authStatus: "AUTHENTICATED",
      companyInfo: {
        CompanyName: companyInfo?.CompanyName || "Unknown",
        Country: companyInfo?.Country || "N/A",
      },
    });
  } catch (e: any) {
    res.json({
      success: false,
      error: e.message,
      latencyMs: Date.now() - start,
    });
  }
});

// Connectors — aggregated health status
router.get("/api/connectors/status", async (req: any, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.user?.tenantId || "tenant_qbo_smb";

    const [integration, odooIntegration, totalInvoices, lastInvoice, totalStamped, totalPending, totalRejected, qboEnvironment] = await Promise.all([
      prisma.integration.findFirst({
        where: { tenantId, sourceSystem: "QUICKBOOKS_ONLINE" },
      }),
      prisma.integration.findFirst({
        where: { tenantId, sourceSystem: "ODOO" },
      }),
      prisma.invoice.count({ where: { tenantId } }),
      prisma.invoice.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
      prisma.invoice.count({ where: { tenantId, status: "APPROVED", irn: { not: null } } }),
      prisma.invoice.count({ where: { tenantId, status: "PENDING_NRS_STAMP" } }),
      prisma.invoice.count({ where: { tenantId, status: "REJECTED" } }),
      getTenantQboEnvironment(tenantId),
    ]);

    res.json({
      qbo: {
        connected: integration?.status === "CONNECTED",
        status: integration?.status || "NOT_CONNECTED",
        companyId: integration?.companyId || null,
        lastSyncAt: integration?.lastSyncAt ? integration.lastSyncAt.toISOString() : null,
        environment: qboEnvironment,
      },
      odoo: {
        connected: odooIntegration?.status === "CONNECTED",
        status: odooIntegration?.status || "NOT_CONNECTED",
        database: odooIntegration?.companyId || null,
        lastSyncAt: odooIntegration?.lastSyncAt ? odooIntegration.lastSyncAt.toISOString() : null,
      },
      excelCsv: {
        totalInvoices,
        lastInvoiceAt: lastInvoice?.createdAt ? lastInvoice.createdAt.toISOString() : null,
      },
      cittaGateway: {
        totalStamped,
        totalPending,
        totalRejected,
      },
    });
  } catch (e: any) {
    console.error("[API Error] GET /api/connectors/status failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
