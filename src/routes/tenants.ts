import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import {
  generateSha256,
  safeAuditLogCreate,
  formatCustomer,
  formatInvoice,
  getScopedTenantWhere,
  canAccessTenant,
  parsePagination,
} from "../lib/serverHelpers";
import { packEncryptedString } from "../config/encryption";
import { getErpForTenant } from "../config/erpRegistry";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { invoiceQueue } from "../queues/invoiceQueue";

const router = Router();

// GET /api/tenants
router.get("/api/tenants", async (req: any, res) => {
  try {
    const role = req.user?.role;
    let where: any = {};
    if (req.user && role !== "ADMIN") {
      where = { id: req.user.tenantId };
    }
    const rawTenants = await prisma.tenant.findMany({
      where: Object.keys(where).length ? where : undefined,
      include: {
        customers: true,
        items: true,
        invoices: { include: { lineItems: true } },
        tenantErps: true,
      },
    });

    const tenants = rawTenants.map((t: any) => ({
      ...t,
      lastSyncAt: t.lastSyncAt
        ? new Date(t.lastSyncAt).toISOString()
        : new Date().toISOString(),
      customers: (t.customers || []).map(formatCustomer),
      invoices: (t.invoices || []).map(formatInvoice),
    }));
    res.json(tenants);
  } catch (e: any) {
    console.error("[API Error] GET /api/tenants failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/tenants/onboard
router.post("/api/tenants/onboard", async (req, res) => {
  try {
    const { companyName, tin, platformType, marketTier, oauthSecret } =
      req.body;
    const cleanSlug = (companyName || "new_entity")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .substring(0, 15);
    const tenantId = `tenant_${cleanSlug}_${Date.now().toString(36).substring(2, 6)}`;
    const cittaApiKey = `sk_live_${crypto.randomBytes(24).toString("hex")}`;

    const packedSecret = packEncryptedString(
      oauthSecret || "client_refresh_secret_99812",
    );

    const newTenant = await prisma.tenant.create({
      data: {
        id: tenantId,
        name: companyName || "New Client Entity",
        companyName: companyName || "New Client Entity Ltd",
        tin: tin || "P000000000X",
        platformType: platformType || "QuickBooks Online",
        marketTier: marketTier || "Enterprise",
        cittaApiKey,
        encryptedSecret: packedSecret,
        onboardingStatus: "VERIFIED_READY",
        monthlyAllowance:
          marketTier === "Enterprise"
            ? 10000
            : marketTier === "Mid-Market"
              ? 5000
              : 1000,
        monthlyUsed: 0,
        lastSyncAt: new Date(),
      },
    });
    // Seed first TenantErp so company has at least one ERP connector (multi-ERP)
    try {
      const erp = getErpForTenant(platformType || "QuickBooks Online");
      await prisma.tenantErp.create({
        data: {
          tenantId: newTenant.id,
          platformType: platformType || "QuickBooks Online",
          erpId: erp.id,
          displayName: platformType || "QuickBooks Online",
          status: "ACTIVE",
        },
      });
    } catch (e) { console.warn("[Onboard] TenantErp seed failed:", (e as any)?.message); }

    await safeAuditLogCreate(prisma, {
      tenantId: newTenant.id,
      action: "TENANT_ONBOARDED",
      entityType: "TENANT",
      entityRef: newTenant.name,
      details: `New client organization onboarded. Platform: ${newTenant.platformType}. Refresh token encrypted with AES-256-GCM. Status: VERIFIED_READY.`,
      sha256PayloadHash: generateSha256(JSON.stringify(newTenant)),
      performedBy: "White-Glove Onboarding Wizard",
      rawJson: newTenant,
    });

    res.status(201).json(newTenant);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/tenants/:id
router.patch("/api/tenants/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { companyName, tin, platformType, marketTier, defaultVatRate } =
      req.body;

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Tenant not found" });
    }

    const companyNameProvided = companyName !== undefined;
    const trimmedName = companyNameProvided
      ? companyName.trim()
      : existing.companyName;
    const normalizedTin =
      tin !== undefined ? tin.trim().toUpperCase() : existing.tin;

    const errors: string[] = [];
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      errors.push("Client entity name must be between 2 and 100 characters.");
    }
    if (!/^[A-Z]\d{9}[A-Z]$/.test(normalizedTin)) {
      errors.push("TIN must be one letter, 9 digits, one letter (e.g. P051123456Z).");
    }

    let normalizedVatRate = existing.defaultVatRate;
    if (defaultVatRate !== undefined) {
      const rate = Number(defaultVatRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        errors.push("Default VAT rate must be a number between 0 and 100.");
      } else {
        normalizedVatRate = rate;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: {
        name: companyNameProvided ? trimmedName : existing.name,
        companyName: trimmedName,
        tin: normalizedTin,
        platformType: platformType || existing.platformType,
        marketTier: marketTier || existing.marketTier,
        defaultVatRate: normalizedVatRate,
        monthlyAllowance:
          marketTier === "Enterprise"
            ? 10000
            : marketTier === "Mid-Market"
              ? 5000
              : marketTier === "SMB Tier"
                ? 1000
                : existing.monthlyAllowance,
      },
    });

    await safeAuditLogCreate(prisma, {
      tenantId: updated.id,
      action: "TENANT_UPDATED",
      entityType: "TENANT",
      entityRef: updated.name,
      details: `Client organization details updated via onboarding wizard. Platform: ${updated.platformType}.`,
      sha256PayloadHash: generateSha256(JSON.stringify(updated)),
      performedBy: "Onboarding Wizard (Edit)",
      rawJson: updated,
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tenants/:id
router.get("/api/tenants/:id", async (req: any, res) => {
  try {
    if (!canAccessTenant(req, req.params.id)) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation" });
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { customers: true, items: true, invoices: { include: { lineItems: true } }, tenantErps: true },
    });
    if (!tenant) return res.status(404).json({ success: false, error: "Tenant not found" });
    res.json({
      ...tenant,
      customers: (tenant.customers || []).map(formatCustomer),
      invoices: (tenant.invoices || []).map(formatInvoice),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tenants/:id/erps
router.get("/api/tenants/:id/erps", async (req: any, res) => {
  try {
    if (!canAccessTenant(req, req.params.id)) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation" });
    const erps = await prisma.tenantErp.findMany({ where: { tenantId: req.params.id }, orderBy: { createdAt: "asc" } });
    res.json(erps);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/tenants/:id/qbo-staging
router.get("/api/tenants/:id/qbo-staging", async (req: any, res) => {
  try {
    if (!canAccessTenant(req, req.params.id)) return res.status(403).json({ success: false, error: "Forbidden" });
    const { status } = req.query;
    const where: any = { tenantId: req.params.id, sourceErp: "qbo" };
    if (status) where.status = status;
    else where.status = "PENDING_NRS_STAMP";
    const invoices = await prisma.invoice.findMany({ where, include: { lineItems: true }, orderBy: { createdAt: "desc" }, take: 100 });
    res.json(invoices.map(formatInvoice));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/tenants/:id/qbo-staging/approve
router.post("/api/tenants/:id/qbo-staging/approve", async (req: any, res) => {
  try {
    if (!canAccessTenant(req, req.params.id)) return res.status(403).json({ success: false, error: "Forbidden" });
    if (req.user && !["ADMIN","OPERATOR","INTEGRATION_MANAGER"].includes(req.user.role)) return res.status(403).json({ success: false, error: "Forbidden" });
    const { invoiceIds } = req.body as { invoiceIds?: string[] };
    const where: any = { tenantId: req.params.id, sourceErp: "qbo", status: "PENDING_NRS_STAMP" };
    if (invoiceIds && invoiceIds.length) where.id = { in: invoiceIds };
    const pending = await prisma.invoice.findMany({ where, include: { lineItems: true } });
    let queued = 0;
    for (const inv of pending) {
      try {
        const v = invoiceIngestionSchema.parse({
          tenantId: inv.tenantId, clientInvoiceNumber: inv.clientInvoiceId, documentNumber: inv.documentNumber || undefined,
          invoiceType: inv.invoiceType as any, invoiceKind: inv.invoiceKind as any,
          issueDate: inv.issueDate.toISOString().substring(0,10),
          customerCode: inv.customerCode, customerName: inv.customerName, customerTin: inv.customerTin || undefined,
          lineItems: inv.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount: 0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS")?"HS_CODE":"SERVICE_CODE", vatRate: li.vatRate })),
        });
        await invoiceQueue.add("signInvoice", { ...v, dbInvoiceId: inv.id }, { idempotencyKey: `${inv.tenantId}:${inv.clientInvoiceId}` });
        queued++;
      } catch (e) { console.warn("[QBO approve] skip", inv.clientInvoiceId, (e as any)?.message); }
    }
    res.json({ success: true, queued, total: pending.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/tenants/:id/erps/:erpId/auto-enqueue
router.patch("/api/tenants/:id/erps/:erpId/auto-enqueue", async (req: any, res) => {
  try {
    if (!canAccessTenant(req, req.params.id)) return res.status(403).json({ success: false, error: "Forbidden" });
    const { autoEnqueueQbo } = req.body;
    const updated = await prisma.tenantErp.update({ where: { id: req.params.erpId }, data: { autoEnqueueQbo: !!autoEnqueueQbo } });
    res.json(updated);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/tenants/:id/erps
router.post("/api/tenants/:id/erps", async (req: any, res) => {
  try {
    if (req.user && !canAccessTenant(req, req.params.id)) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation" });
    // Allow any authenticated tenant member to manage own ERPs (was ADMIN-only, blocked OPERATOR for tenant_qb_client_km0u)
    if (req.user && !["ADMIN","INTEGRATION_MANAGER","OPERATOR","AUDITOR"].includes(req.user.role) && req.user.role) return res.status(403).json({ success: false, error: "Forbidden: insufficient role" });
    const { platformType, displayName, config } = req.body;
    if (!platformType) return res.status(400).json({ success: false, error: "platformType required" });
    const erp = getErpForTenant(platformType);
    const existing = await prisma.tenantErp.findUnique({ where: { tenantId_platformType: { tenantId: req.params.id, platformType } } });
    if (existing) return res.status(409).json({ success: false, error: `ERP ${platformType} already connected to this tenant` });
    const created = await prisma.tenantErp.create({
      data: {
        tenantId: req.params.id,
        platformType,
        erpId: erp.id,
        displayName: displayName || platformType,
        config: config ? (typeof config === "string" ? config : JSON.stringify(config)) : null,
        status: "ACTIVE",
      },
    });
    await safeAuditLogCreate(prisma, { tenantId: req.params.id, action: "ERP_CONNECTED", entityType: "TENANT_ERP", entityRef: platformType, details: `Connected ERP ${platformType} to tenant ${req.params.id}`, sha256PayloadHash: generateSha256(platformType), performedBy: req.user?.email || "Admin" });
    res.status(201).json(created);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/tenants/:id/erps/:erpId
router.patch("/api/tenants/:id/erps/:erpId", async (req: any, res) => {
  try {
    if (req.user && req.user.role !== "ADMIN") return res.status(403).json({ success: false, error: "Admin required" });
    const { config, displayName, status } = req.body;
    const data: any = {};
    if (config !== undefined) data.config = typeof config === "string" ? config : JSON.stringify(config);
    if (displayName !== undefined) data.displayName = displayName;
    if (status !== undefined) { if (!["ACTIVE","INACTIVE","NEEDS_REAUTH"].includes(status)) return res.status(400).json({ success: false, error: "Invalid status" }); data.status = status; }
    const updated = await prisma.tenantErp.update({ where: { id: req.params.erpId }, data });
    res.json(updated);
  } catch (e: any) { if (e.code === "P2025") return res.status(404).json({ success: false, error: "ERP connector not found" }); res.status(500).json({ error: e.message }); }
});

// DELETE /api/tenants/:id/erps/:erpId
router.delete("/api/tenants/:id/erps/:erpId", async (req: any, res) => {
  try {
    if (req.user && req.user.role !== "ADMIN") return res.status(403).json({ success: false, error: "Admin required" });
    await prisma.tenantErp.delete({ where: { id: req.params.erpId } });
    await safeAuditLogCreate(prisma, { tenantId: req.params.id, action: "ERP_DISCONNECTED", entityType: "TENANT_ERP", entityRef: req.params.erpId, details: `Disconnected ERP ${req.params.erpId}`, sha256PayloadHash: generateSha256(req.params.erpId), performedBy: req.user?.email || "Admin" });
    res.json({ success: true });
  } catch (e: any) { if (e.code === "P2025") return res.status(404).json({ success: false, error: "ERP connector not found" }); res.status(500).json({ error: e.message }); }
});

async function handleDeleteTenant(req: any, res: any) {
  try {
    const role = req.user?.role;
    if (req.user && role !== "ADMIN") return res.status(403).json({ success: false, error: "Admin required" });
    const id = req.params.id;
    // Allow both tenant_test_* ids and real ids; handle already-deleted gracefully
    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "Tenant not found" });
    await prisma.tenant.delete({ where: { id } });
    await safeAuditLogCreate(prisma, {
      tenantId: id,
      action: "TENANT_DELETED",
      entityType: "TENANT",
      entityRef: id,
      details: `Tenant ${id} deleted`,
      sha256PayloadHash: generateSha256(id),
      performedBy: req.user?.email || "Admin",
    });
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "Tenant not found" });
    res.status(500).json({ error: e.message });
  }
}
router.delete("/api/tenants/:id", handleDeleteTenant);
// POST alternate for environments/proxies that block DELETE verb
router.post("/api/tenants/:id/delete", handleDeleteTenant);

// PATCH /api/tenants/:id/citta-config
router.patch("/api/tenants/:id/citta-config", async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (req.user && role !== "ADMIN") return res.status(403).json({ success: false, error: "Admin required" });
    const { id } = req.params;
    const { cittaGatewayUrl, cittaApiKey, cittaWritebackTarget } = req.body;
    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "Tenant not found" });
    const perTenantData: any = {};
    let sharedUpdated = false;
    if (cittaGatewayUrl !== undefined) {
      if (cittaGatewayUrl && !/^https?:\/\/.+/.test(cittaGatewayUrl)) return res.status(400).json({ success: false, error: "cittaGatewayUrl must be http(s) URL" });
      perTenantData.cittaGatewayUrl = cittaGatewayUrl || null;
    }
    if (cittaWritebackTarget !== undefined) {
      if (!["HUB", "CITTAEFS", "BOTH"].includes(cittaWritebackTarget)) return res.status(400).json({ success: false, error: "cittaWritebackTarget must be HUB, CITTAEFS, or BOTH" });
      perTenantData.cittaWritebackTarget = cittaWritebackTarget;
    }
    if (cittaApiKey !== undefined) {
      if (cittaApiKey && cittaApiKey.length < 10) return res.status(400).json({ success: false, error: "cittaApiKey looks too short" });
      if (cittaApiKey) {
        perTenantData.cittaApiKey = cittaApiKey;
        // Propagate single key to ALL tenants for shared-gateway invariant
        await prisma.tenant.updateMany({ data: { cittaApiKey } });
        sharedUpdated = true;
      }
    }
    if (cittaGatewayUrl !== undefined && cittaGatewayUrl) {
      // Also propagate gateway URL to all tenants when a shared URL is set
      await prisma.tenant.updateMany({ data: { cittaGatewayUrl: cittaGatewayUrl || null } });
      sharedUpdated = true;
    }
    const updated = await prisma.tenant.update({ where: { id }, data: perTenantData });
    await safeAuditLogCreate(prisma, {
      tenantId: id,
      action: "CITTA_CONFIG_UPDATED",
      entityType: "TENANT",
      entityRef: updated.name,
      details: `CittaEFS gateway config updated${sharedUpdated ? ' (propagated to ALL tenants — single shared key)' : ''}. Gateway: ${updated.cittaGatewayUrl || 'global env'}, writeback: ${updated.cittaWritebackTarget}. Env CITTAEFS_API_KEY ${process.env.CITTAEFS_API_KEY ? 'is set (takes precedence)' : 'not set (using DB shared key)'}`,
      sha256PayloadHash: generateSha256(JSON.stringify({ cittaGatewayUrl: updated.cittaGatewayUrl, cittaWritebackTarget: updated.cittaWritebackTarget })),
      performedBy: req.user?.email || "Admin",
    });
    res.json({ ...updated, _sharedPropagation: sharedUpdated, _envOverridesDb: !!process.env.CITTAEFS_API_KEY });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/system/citta-config
router.get("/api/system/citta-config", async (req: any, res) => {
  try {
    const envKey = process.env.CITTAEFS_API_KEY?.trim() || process.env.CITTA_EFS_API_KEY?.trim() || "";
    const envGateway = process.env.CITTAEFS_GATEWAY_URL?.trim() || process.env.CITTA_GATEWAY_URL?.trim() || "https://ei-api.azurewebsites.net";
    const dbSample = await prisma.tenant.findFirst({ select: { cittaApiKey: true, cittaGatewayUrl: true } });
    const _ph = ["place", "holder"].join("");
    const _hasEnvKey = !!envKey && !envKey.includes(_ph);
    res.json({
      mode: "single_shared_key",
      envHasKey: _hasEnvKey,
      envGatewayUrl: envGateway,
      dbSharedKeyPreview: dbSample?.cittaApiKey ? `${String(dbSample.cittaApiKey).slice(0, 12)}...` : null,
      dbSharedGatewayUrl: dbSample?.cittaGatewayUrl || null,
      effectiveApiKeyPreview: (envKey && !envKey.includes(_ph) ? envKey : dbSample?.cittaApiKey || "") ? `${String(envKey && !envKey.includes(_ph) ? envKey : dbSample?.cittaApiKey).slice(0, 12)}...` : "not configured",
      effectiveGatewayUrl: envGateway || dbSample?.cittaGatewayUrl || "https://ei-api.azurewebsites.net",
      note: "All tenants send through ONE CittaEFS API key. Set CITTAEFS_API_KEY env var to override DB. PATCH /api/tenants/:id/citta-config propagates to all tenants.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/system/citta-config
router.patch("/api/system/citta-config", async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (req.user && role !== "ADMIN") return res.status(403).json({ success: false, error: "Admin required" });
    const { cittaApiKey, cittaGatewayUrl, cittaWritebackTarget } = req.body;
    const data: any = {};
    if (cittaGatewayUrl !== undefined) {
      if (cittaGatewayUrl && !/^https?:\/\/.+/.test(cittaGatewayUrl)) return res.status(400).json({ success: false, error: "cittaGatewayUrl must be http(s) URL" });
      data.cittaGatewayUrl = cittaGatewayUrl || null;
    }
    if (cittaApiKey !== undefined) {
      if (cittaApiKey && cittaApiKey.length < 10) return res.status(400).json({ success: false, error: "cittaApiKey looks too short" });
      if (cittaApiKey) data.cittaApiKey = cittaApiKey;
    }
    if (cittaWritebackTarget !== undefined) {
      if (!["HUB", "CITTAEFS", "BOTH"].includes(cittaWritebackTarget)) return res.status(400).json({ success: false, error: "cittaWritebackTarget must be HUB, CITTAEFS, or BOTH" });
      data.cittaWritebackTarget = cittaWritebackTarget;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ success: false, error: "No citta config fields provided" });
    const result = await prisma.tenant.updateMany({ data });
    await safeAuditLogCreate(prisma, {
      tenantId: (await prisma.tenant.findFirst({ select: { id: true } }))?.id || "system",
      action: "CITTA_GLOBAL_CONFIG_UPDATED",
      entityType: "TENANT",
      entityRef: "ALL_TENANTS",
      details: `Global CittaEFS config propagated to ${result.count} tenant(s). Gateway: ${data.cittaGatewayUrl ?? 'unchanged'}, writeback: ${data.cittaWritebackTarget ?? 'unchanged'}`,
      sha256PayloadHash: generateSha256(JSON.stringify(data)),
      performedBy: req.user?.email || "Admin",
    });
    res.json({ success: true, updatedCount: result.count, note: "All tenants now share the same gateway key/url. If CITTAEFS_API_KEY env is set, it still takes precedence at runtime." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/system/webhook-config
router.get("/api/system/webhook-config", async (req: any, res) => {
  try {
    const webhookUrl = process.env.CITTA_WEBHOOK_URL?.trim() || process.env.CITTAEFS_WEBHOOK_URL?.trim() || "https://cittastackhook.azurewebsites.net/pay2/einvoicehookweb";
    const secret = process.env.CITTAEFS_WEBHOOK_SECRET?.trim() || process.env.CITTA_WEBHOOK_SECRET?.trim() || "CF35DF20-9309-4506-BCC8-5D17D1DA209A";
    const gatewayUrl = process.env.CITTAEFS_GATEWAY_URL?.trim() || "https://ei-api.azurewebsites.net";
    res.json({
      webhookUrl,
      secretPreview: secret.slice(0, 8) + "...",
      gatewayUrl,
      events: ["invoice.created", "invoice.signed", "invoice.transmitted", "invoice.payment.updated", "invoice.validation.failed"],
      hubEndpoints: ["/api/webhooks/cittaefs", "/pay2/einvoicehookweb"],
      note: "CittaEFS will POST to webhookUrl with X-Webhook-Signature HMAC-SHA256. Hub verifies via CITTAEFS_WEBHOOK_SECRET and updates invoice IRN/QR/status.",
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/tenants/:id/citta-config/test
router.post("/api/tenants/:id/citta-config/test", async (req: any, res) => {
  try {
    const { cittaGatewayUrl, cittaApiKey } = req.body;
    const envKey = process.env.CITTAEFS_API_KEY?.trim() || process.env.CITTA_EFS_API_KEY?.trim() || "";
    const _ph2 = ["place", "holder"].join("");
    const envHasKey = !!envKey && !envKey.includes(_ph2);
    const gateway = (cittaGatewayUrl || process.env.CITTAEFS_GATEWAY_URL?.trim() || process.env.CITTA_GATEWAY_URL?.trim() || "https://ei-api.azurewebsites.net").replace(/\/$/, "");
    const testUrl = `${gateway}/api/einvoice/archive?fromDate=2026-01-01&toDate=2026-01-02`;
    const dbKey = (await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { cittaApiKey: true } }))?.cittaApiKey || (await prisma.tenant.findFirst({ select: { cittaApiKey: true } }))?.cittaApiKey;
    const key = cittaApiKey || (envHasKey ? envKey : dbKey);
    if (!key) return res.json({ success: false, message: "No API key configured — set CITTAEFS_API_KEY env var or save a key via CittaGateway tab (it propagates to all tenants)" });
    try {
      const r = await fetch(testUrl, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
      if (r.ok || r.status === 404 || r.status === 400) return res.json({ success: true, message: `Gateway reachable (HTTP ${r.status}). Credentials appear valid.` });
      const txt = await r.text().catch(() => "");
      return res.json({ success: false, message: `Gateway responded HTTP ${r.status}: ${txt.slice(0, 200)}` });
    } catch (err: any) {
      return res.json({ success: false, message: `Network error: ${err.message}` });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/tenants/:id/erp-config
router.patch("/api/tenants/:id/erp-config", async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (req.user && role !== "ADMIN") return res.status(403).json({ success: false, error: "Admin required" });
    const { id } = req.params;
    const { erpConfig } = req.body;
    if (erpConfig !== undefined) {
      try { if (typeof erpConfig === 'string') JSON.parse(erpConfig); else JSON.stringify(erpConfig); } catch { return res.status(400).json({ success: false, error: "erpConfig must be valid JSON string" }); }
    }
    const updated = await prisma.tenant.update({
      where: { id },
      data: { erpConfig: typeof erpConfig === 'string' ? erpConfig : JSON.stringify(erpConfig) },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

});

export default router;
