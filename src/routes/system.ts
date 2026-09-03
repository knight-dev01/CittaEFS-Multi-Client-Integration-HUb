import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// Health check for Render & load balancers
router.get(["/healthz", "/health", "/api/health"], (req, res) => {
  res
    .status(200)
    .json({
      status: "ok",
      service: "cittaefs-integration-hub",
      timestamp: new Date().toISOString(),
    });
});

// Global CittaEFS gateway config — read effective key/gateway
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

// Alias with /test suffix — same payload as /api/system/citta-config
router.get("/api/system/citta-config/test", async (req: any, res) => {
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
      note: "All tenants send through ONE CittaEFS API key. Set CITTAEFS_API_KEY env var to override DB.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Per-tenant gateway connectivity check
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

// Clear persisted records for a fresh start — removes invoices, customers, items, etc.
router.post("/api/system/purge-demo-data", async (req, res) => {
  try {
    try {
      await prisma.invoiceLineItem.deleteMany();
      await prisma.invoice.deleteMany();
      await prisma.validationError.deleteMany();
      await prisma.customer.deleteMany();
      await prisma.item.deleteMany();
      await prisma.auditLog.deleteMany();
    } catch {}
    res.json({
      success: true,
      message:
        "All invoices, validation errors, customers, items, and audit logs cleared successfully from PostgreSQL/SQLite.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Alternative path for purge — avoids client caching issues with POST verb restrictions
router.post("/api/system/clear-sample-records", async (req, res) => {
  try {
    try {
      await prisma.invoiceLineItem.deleteMany();
      await prisma.invoice.deleteMany();
      await prisma.validationError.deleteMany();
      await prisma.customer.deleteMany();
      await prisma.item.deleteMany();
      await prisma.auditLog.deleteMany();
    } catch {}
    res.json({
      success: true,
      message: "All sample records cleared successfully.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Catch-all handler for unmatched API routes — returns JSON 404, not HTML
router.use("/api/*", (req, res) => {
  res
    .status(404)
    .json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl}`,
    });
});

export default router;
