import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import {
  generateSha256,
  safeAuditLogCreate,
  renderOAuthBridgeHtml,
  getAuthConfig,
} from "../lib/serverHelpers";
import { packEncryptedString } from "../config/encryption";
import {
  fetchQboInvoices,
  fetchAllQboInvoicesPaginated,
  fetchQboCompanyInfo,
  ingestQboInvoice,
} from "../services/qboService";

const router = Router();
const { JWT_SECRET } = getAuthConfig();

// QuickBooks Online OAuth2 — connect (initiate)
router.get("/api/integrations/qbo/connect", async (req: any, res) => {
  const wantsJson = req.headers.accept?.includes("application/json");
  try {
    const userRole = req.user?.role;
    if (userRole && !["ADMIN", "INTEGRATION_MANAGER"].includes(userRole)) {
      const error = "Forbidden: Requires ADMIN or INTEGRATION_MANAGER role";
      if (wantsJson) return res.status(403).json({ error });
      return res
        .status(403)
        .send(
          renderOAuthBridgeHtml({
            success: false,
            error,
            redirectQs: "qbo=error",
          }),
        );
    }

    const tenantId =
      (req.query.tenantId as string) ||
      req.user?.tenantId ||
      "tenant_qbo_smb";
    const clientId = process.env.QBO_CLIENT_ID;
    const redirectUri = process.env.QBO_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      const error =
        "QBO_CLIENT_ID and QBO_REDIRECT_URI environment variables are required";
      if (wantsJson) return res.status(400).json({ error });
      return res
        .status(400)
        .send(
          renderOAuthBridgeHtml({
            success: false,
            error,
            redirectQs: "qbo=error",
          }),
        );
    }

    const stateToken = jwt.sign(
      { tenantId, timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: "15m" },
    );
    const qboAuthUrl = `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=com.intuit.quickbooks.accounting&state=${encodeURIComponent(stateToken)}`;

    if (wantsJson) {
      return res.json({ url: qboAuthUrl });
    }

    res.redirect(qboAuthUrl);
  } catch (e: any) {
    if (wantsJson) return res.status(500).json({ error: e.message });
    res
      .status(500)
      .send(
        renderOAuthBridgeHtml({
          success: false,
          error: e.message,
          redirectQs: "qbo=error",
        }),
      );
  }
});

// QuickBooks Online OAuth2 — callback
router.get("/api/integrations/qbo/callback", async (req, res) => {
  try {
    const { code, state, realmId } = req.query;
    if (!code || !state) {
      return res
        .status(400)
        .send(
          renderOAuthBridgeHtml({
            success: false,
            error: "Missing code or state parameter in callback",
            redirectQs: "qbo=error",
          }),
        );
    }

    let decoded: any;
    try {
      decoded = jwt.verify(state as string, JWT_SECRET);
    } catch (e) {
      return res
        .status(401)
        .send(
          renderOAuthBridgeHtml({
            success: false,
            error: "Invalid or expired state parameter",
            redirectQs: "qbo=error",
          }),
        );
    }

    const tenantId = decoded.tenantId;
    const clientId = process.env.QBO_CLIENT_ID;
    const clientSecret = process.env.QBO_CLIENT_SECRET;
    const redirectUri = process.env.QBO_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return res
        .status(500)
        .send(
          renderOAuthBridgeHtml({
            success: false,
            error:
              "QBO_CLIENT_ID, QBO_CLIENT_SECRET, or QBO_REDIRECT_URI missing in server config",
            redirectQs: "qbo=error",
          }),
        );
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const tokenRes = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: redirectUri,
        }).toString(),
      },
    );

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("QBO Token Exchange Error:", errText);
      return res
        .status(400)
        .send(
          renderOAuthBridgeHtml({
            success: false,
            error: `QBO OAuth token exchange failed: ${errText}`,
            redirectQs: "qbo=error",
          }),
        );
    }

    const tokenData = (await tokenRes.json()) as any;
    const { access_token, refresh_token, expires_in } = tokenData;
    const encryptedAccess = packEncryptedString(access_token);
    const encryptedRefresh = packEncryptedString(refresh_token);
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    await prisma.integration.upsert({
      where: {
        tenantId_sourceSystem: {
          tenantId,
          sourceSystem: "QUICKBOOKS_ONLINE",
        },
      },
      create: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        companyId: (realmId as string) || "UNKNOWN_REALM",
        accessTokenExpiresAt: expiresAt,
        status: "CONNECTED",
      },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        companyId: (realmId as string) || "UNKNOWN_REALM",
        accessTokenExpiresAt: expiresAt,
        status: "CONNECTED",
      },
    });

    await safeAuditLogCreate(prisma, {
      tenantId,
      action: "CONNECTOR_AUTHENTICATED",
      entityType: "INTEGRATION",
      entityRef: (realmId as string) || "QUICKBOOKS_ONLINE",
      details: `QuickBooks Online OAuth authenticated successfully for realm ${realmId}`,
      sha256PayloadHash: generateSha256(String(realmId || "QBO")),
      performedBy: "QBO OAuth Callback",
      rawJson: { sourceSystem: "QUICKBOOKS_ONLINE", realmId },
    });

    res.send(
      renderOAuthBridgeHtml({
        success: true,
        tenantId,
        realmId: (realmId as string) || "",
        redirectQs: `qbo=success&tenantId=${encodeURIComponent(tenantId)}&realmId=${encodeURIComponent((realmId as string) || "")}`,
      }),
    );
  } catch (e: any) {
    console.error("QBO Callback Error:", e);
    res
      .status(500)
      .send(
        renderOAuthBridgeHtml({
          success: false,
          error: `Server error during QBO callback: ${e.message}`,
          redirectQs: "qbo=error",
        }),
      );
  }
});

// QuickBooks Online — status
router.get("/api/integrations/qbo/status", async (req: any, res) => {
  try {
    const tenantId =
      (req.query.tenantId as string) ||
      req.user?.tenantId ||
      "tenant_qbo_smb";
    const integration = await prisma.integration.findUnique({
      where: {
        tenantId_sourceSystem: {
          tenantId,
          sourceSystem: "QUICKBOOKS_ONLINE",
        },
      },
    });

    if (!integration) {
      return res.json({
        connected: false,
        status: "DISCONNECTED",
        companyId: null,
      });
    }

    res.json({
      connected: integration.status === "CONNECTED",
      status: integration.status,
      companyId: integration.companyId,
      lastSyncAt: integration.lastSyncAt,
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

    let rawInvoices: any[] = [];
    try {
      rawInvoices = await fetchAllQboInvoicesPaginated(tenantId);
    } catch (fetchErr: any) {
      console.warn(
        "[QBO Sync] Paginated fetch failed, trying standard fetch:",
        fetchErr,
      );
      rawInvoices = await fetchQboInvoices(tenantId);
    }

    const totalFound = rawInvoices.length;
    let newSynced = 0;
    let alreadySynced = 0;
    const processedInvoices = [];

    for (const rawInv of rawInvoices) {
      try {
        const clientInvoiceId = rawInv.Id;
        const existing = await prisma.invoice.findFirst({
          where: { tenantId, clientInvoiceId },
        });

        const dbInv = await ingestQboInvoice(tenantId, rawInv);
        if (existing) {
          alreadySynced++;
        } else {
          newSynced++;
        }
        processedInvoices.push(dbInv);
      } catch (err: any) {
        console.warn(`[QBO Sync Warning] Skipped invoice: ${err.message}`);
      }
    }

    try {
      await safeAuditLogCreate(prisma, {
        tenantId,
        action: "QBO_HISTORICAL_SYNC",
        entityType: "INTEGRATION",
        entityRef: "QUICKBOOKS_ONLINE",
        details: `QBO historical sync completed. Total found: ${totalFound}, New synced: ${newSynced}, Already synced: ${alreadySynced}`,
        sha256PayloadHash: generateSha256(tenantId + Date.now()),
        performedBy: req.user?.email || "Sync Operator",
      });
    } catch {}

    res.json({
      success: true,
      totalFound,
      newSynced,
      alreadySynced,
      count: processedInvoices.length,
      invoices: processedInvoices,
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
      environment: (process.env.QBO_ENVIRONMENT || "sandbox").toUpperCase(),
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

    const [integration, totalInvoices, lastInvoice, totalStamped, totalPending, totalRejected] = await Promise.all([
      prisma.integration.findUnique({
        where: { tenantId_sourceSystem: { tenantId, sourceSystem: "QUICKBOOKS_ONLINE" } },
      }),
      prisma.invoice.count({ where: { tenantId } }),
      prisma.invoice.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
      prisma.invoice.count({ where: { tenantId, status: "APPROVED", irn: { not: null } } }),
      prisma.invoice.count({ where: { tenantId, status: "PENDING_NRS_STAMP" } }),
      prisma.invoice.count({ where: { tenantId, status: "REJECTED" } }),
    ]);

    res.json({
      qbo: {
        connected: integration?.status === "CONNECTED",
        status: integration?.status || "NOT_CONNECTED",
        companyId: integration?.companyId || null,
        lastSyncAt: integration?.lastSyncAt ? integration.lastSyncAt.toISOString() : null,
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
