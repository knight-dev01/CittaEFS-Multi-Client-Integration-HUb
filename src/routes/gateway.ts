import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import {
  generateSha256,
  safeAuditLogCreate,
  formatInvoice,
  parsePagination,
  getAuthConfig,
} from "../lib/serverHelpers";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { invoiceQueue } from "../queues/invoiceQueue";
import { packEncryptedString } from "../config/encryption";
import { getErpForTenant } from "../config/erpRegistry";
import { openApiV1Spec } from "../config/openApiV1";
import {
  dispatchMerchantWebhook,
  getMerchantWebhookConfig,
  saveMerchantWebhookConfig,
  verifyWebhookSignature,
} from "../services/merchantWebhook";

const router = Router();

// ---------------------------------------------------------------------------
// Interswitch-style facade (additive). Internal standard schema + send flow
// in src/schemas/invoice.schema.ts and POST /api/hub/v1/invoices are untouched.
// This router only maps Interswitch naming to the same validated flow.
// ---------------------------------------------------------------------------

function getModeForTenant(tenant: { cittaGatewayUrl?: string | null } | null): "test" | "live" {
  const url = (
    process.env.CITTAEFS_GATEWAY_URL ||
    process.env.CITTA_GATEWAY_URL ||
    (tenant?.cittaGatewayUrl as string) ||
    ""
  ).toLowerCase();
  if (!url) return "live";
  if (url.includes("sandbox") || url.includes("localhost") || url.includes("127.0.0.1") || url.includes("test")) return "test";
  return "live";
}

function toResponseCode(status: string): { code: string; description: string } {
  if (status === "APPROVED" || status === "SIGNED" || status === "SYNCED") {
    return { code: "00", description: "Approved" };
  }
  if (status === "REJECTED" || status === "CANCELLED" || status === "FAILED") {
    return { code: "11", description: "Rejected" };
  }
  return { code: "09", description: "Pending" };
}

// Resolve merchant tenant from API key headers, bearer token (raw key or JWT), or explicit ids.
async function resolveMerchantTenant(req: any): Promise<string | null> {
  const apiKey =
    (req.headers["x-hub-api-key"] as string) ||
    (req.headers["x-api-key"] as string) ||
    (req.headers["merchant-code"] as string) ||
    null;
  if (apiKey) {
    const byKey = await prisma.tenant.findFirst({ where: { cittaApiKey: apiKey } });
    if (byKey) return byKey.id;
    const byId = await prisma.tenant.findUnique({ where: { id: apiKey } });
    if (byId) return byId.id;
  }
  const auth = req.headers.authorization as string | undefined;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const byKey = await prisma.tenant.findFirst({ where: { cittaApiKey: token } });
      if (byKey) return byKey.id;
      try {
        const { JWT_SECRET } = getAuthConfig();
        const decoded: any = jwt.verify(token, JWT_SECRET);
        const tid = decoded.merchantCode || decoded.tenantId || decoded.userId || decoded.id;
        if (tid) {
          const t = await prisma.tenant.findUnique({ where: { id: String(tid) } });
          if (t) return t.id;
        }
      } catch {
        // not a JWT — continue to body/query ids
      }
    }
  }
  const bodyId = req.body?.merchantCode || req.body?.tenantId || req.body?.merchant_code;
  if (bodyId) {
    const t = await prisma.tenant.findUnique({ where: { id: String(bodyId) } });
    if (t) return t.id;
  }
  const qId = (req.query?.merchantCode as string) || (req.query?.tenantId as string);
  if (qId) {
    const t = await prisma.tenant.findUnique({ where: { id: String(qId) } });
    if (t) return t.id;
  }
  return null;
}

// GET /api/v1/health
router.get("/api/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "citta-interswitch-gateway",
    timestamp: new Date().toISOString(),
    version: "1.0",
  });
});

// GET /api/v1/channels — ERP sources exposed as switch channels
router.get("/api/v1/channels", (_req, res) => {
  res.json({
    success: true,
    data: [
      { id: "qbo", label: "QuickBooks Online", modes: ["oauth", "webhook", "poll"], status: "ACTIVE" },
      { id: "odoo", label: "Odoo ERP", modes: ["apikey", "poll"], status: "ACTIVE" },
      { id: "api", label: "Direct API", modes: ["rest"], status: "ACTIVE" },
      { id: "file", label: "File Drop", modes: ["xlsx", "csv"], status: "ACTIVE" },
    ],
  });
});

// POST /api/v1/auth/token — { clientId|merchantCode, clientSecret|apiKey } -> Bearer access token
router.post("/api/v1/auth/token", async (req, res) => {
  try {
    const clientId = req.body?.clientId || req.body?.merchantCode || req.body?.merchant_code;
    const clientSecret = req.body?.clientSecret || req.body?.apiKey || req.body?.api_key;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ success: false, error: "clientId and clientSecret are required" });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: String(clientId) } });
    if (!tenant || tenant.cittaApiKey !== String(clientSecret)) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
    const { JWT_SECRET } = getAuthConfig();
    const payload = { merchantCode: tenant.id, tenantId: tenant.id, type: "merchant_access" };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
    await safeAuditLogCreate(prisma, {
      tenantId: tenant.id,
      action: "MERCHANT_TOKEN_ISSUED",
      entityType: "TENANT",
      entityRef: tenant.id,
      details: "Interswitch-style access token issued for merchant channel.",
      sha256PayloadHash: generateSha256(tenant.id + Date.now()),
      performedBy: "gateway",
    });
    res.json({
      success: true,
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 28800,
      merchantCode: tenant.id,
      mode: getModeForTenant(tenant),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/v1/merchants/onboard — self-service merchant creation (same Tenant flow as /api/tenants/onboard)
router.post("/api/v1/merchants/onboard", async (req, res) => {
  try {
    const businessName = req.body?.businessName || req.body?.companyName || req.body?.company_name;
    const tin = req.body?.tin || req.body?.customerTin;
    const platformType = req.body?.platformType || req.body?.channel || "QuickBooks Online";
    const marketTier = req.body?.marketTier || "Enterprise";
    if (!businessName) {
      return res.status(400).json({ success: false, error: "businessName is required" });
    }
    const cleanSlug = String(businessName).toLowerCase().replace(/[^a-z0-9]/g, "_").substring(0, 15) || "new_entity";
    const tenantId = `tenant_${cleanSlug}_${Date.now().toString(36).substring(2, 6)}`;
    const cittaApiKey = `sk_live_${crypto.randomBytes(24).toString("hex")}`;
    const packedSecret = packEncryptedString("client_refresh_secret_99812");
    const newTenant = await prisma.tenant.create({
      data: {
        id: tenantId,
        name: String(businessName),
        companyName: String(businessName),
        tin: tin ? String(tin) : "P000000000X",
        platformType: String(platformType),
        marketTier: String(marketTier),
        cittaApiKey,
        encryptedSecret: packedSecret,
        onboardingStatus: "VERIFIED_READY",
        monthlyAllowance: marketTier === "Enterprise" ? 10000 : marketTier === "Mid-Market" ? 5000 : 1000,
        monthlyUsed: 0,
        lastSyncAt: new Date(),
      },
    });
    let payItemId: string | null = null;
    try {
      const erp = getErpForTenant(String(platformType));
      const erpRow = await prisma.tenantErp.create({
        data: {
          tenantId: newTenant.id,
          platformType: String(platformType),
          erpId: erp.id,
          displayName: String(platformType),
          status: "ACTIVE",
        },
      });
      payItemId = erpRow.id;
    } catch (e) {
      console.warn("[MerchantOnboard] TenantErp seed skipped:", (e as any)?.message);
    }
    await safeAuditLogCreate(prisma, {
      tenantId: newTenant.id,
      action: "MERCHANT_ONBOARDED",
      entityType: "TENANT",
      entityRef: newTenant.name,
      details: `Merchant onboarded via Interswitch-style gateway in test mode. Channel: ${newTenant.platformType}.`,
      sha256PayloadHash: generateSha256(JSON.stringify({ id: newTenant.id })),
      performedBy: "gateway-onboard",
      rawJson: { id: newTenant.id },
    });
    res.status(201).json({
      success: true,
      merchantCode: newTenant.id,
      payItemId,
      testApiKey: cittaApiKey,
      mode: "test",
      message: "Merchant created in test mode. Complete verification to go live.",
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/v1/transactions/initialize — Interswitch naming mapped to invoiceIngestionSchema (same send flow)
router.post("/api/v1/transactions/initialize", async (req, res) => {
  try {
    const tenantId = await resolveMerchantTenant(req);
    if (!tenantId) {
      return res.status(401).json({ success: false, ResponseCode: "07", error: "Missing or invalid credentials. Provide X-Hub-Api-Key or Bearer token." });
    }
    const body = req.body || {};
    const clientInvoiceNumber = body.clientInvoiceNumber || body.invoiceNumber || body.order_id || body.txn_ref || body.transactionRef || body.clientInvoiceId;
    const rawItems = body.lineItems || body.items || body.order_items || [];
    const mapped = {
      tenantId,
      clientInvoiceNumber,
      documentNumber: body.documentNumber || body.document_number,
      invoiceKind: body.invoiceKind || body.invoice_kind || "B2B",
      invoiceType: body.invoiceType || body.invoice_type || "STANDARD",
      invoiceTypeCode: body.invoiceTypeCode || body.invoice_type_code,
      originalIrn: body.originalIrn || body.original_irn || body.billingReferenceIrn,
      billingReferenceIrns: body.billingReferenceIrns || body.billing_reference_irns,
      issueDate: body.issueDate || body.issue_date || body.transactionDate || new Date().toISOString().substring(0, 10),
      customerCode: body.customerCode || body.customer_code || body.merchant_code || "CUST-EXTERNAL",
      customerName: body.customerName || body.customer_name || body.customerName_,
      customerTin: body.customerTin || body.customer_tin,
      headerDiscount: body.headerDiscount !== undefined ? Number(body.headerDiscount) : 0,
      headerCharges: body.headerCharges !== undefined ? Number(body.headerCharges) : 0,
      lineItems: (Array.isArray(rawItems) ? rawItems : []).map((li: any) => ({
        itemCode: li.itemCode || li.sku || li.ItemCode || li.item_name || "SKU-GENERIC",
        description: li.description || li.desc || li.ItemDescription || li.item_description || "Item",
        quantity: Number(li.quantity || li.qty || 1),
        unitPrice: Number(li.unitPrice || li.price || li.unit_price || 0),
        discountAmount: Number(li.discountAmount || li.discount || 0),
        hsOrServiceCode: li.hsOrServiceCode || li.hsCode || li.hs_code || "UNMAPPED",
        vatRate: li.vatRate !== undefined ? Number(li.vatRate) : undefined,
      })),
    };
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ success: false, ResponseCode: "25", error: "Merchant not found" });
    // Same internal standard validation as hub flow — do not bypass.
    const validated = invoiceIngestionSchema.parse({
      tenantId,
      clientInvoiceNumber: mapped.clientInvoiceNumber,
      documentNumber: mapped.documentNumber,
      invoiceType: mapped.invoiceType as any,
      invoiceTypeCode: (mapped as any).invoiceTypeCode,
      invoiceKind: mapped.invoiceKind as any,
      issueDate: mapped.issueDate,
      customerCode: mapped.customerCode,
      customerName: mapped.customerName,
      customerTin: mapped.customerTin,
      originalIrn: mapped.originalIrn,
      billingReferenceIrns: (mapped as any).billingReferenceIrns,
      headerDiscount: mapped.headerDiscount,
      headerCharges: mapped.headerCharges,
      lineItems: mapped.lineItems,
    } as any);
    const dup = await prisma.invoice.findFirst({ where: { tenantId, clientInvoiceId: validated.clientInvoiceNumber } });
    if (dup) {
      return res.status(409).json({ success: false, ResponseCode: "26", error: `Duplicate transaction ${validated.clientInvoiceNumber}` });
    }
    const rawNewInvoice = await prisma.invoice.create({
      data: {
        tenantId,
        clientInvoiceId: validated.clientInvoiceNumber,
        documentNumber: (validated as any).documentNumber || null,
        invoiceType: validated.invoiceType,
        invoiceKind: validated.invoiceKind,
        issueDate: new Date(validated.issueDate),
        customerCode: validated.customerCode,
        customerName: validated.customerName,
        customerTin: (validated as any).customerTin || null,
        currency: "NGN",
        subtotal: validated.subtotal,
        taxAmount: validated.totalVat,
        totalAmount: validated.grandTotal,
        status: "PENDING_NRS_STAMP",
        ledgerWritebackStatus: "PENDING",
        callbackUrl: body.callbackUrl || body.webhookUrl || body.callback_url || null,
        lineItems: {
          create: validated.lineItems.map((li: any) => ({
            itemCode: li.itemCode,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            taxableAmount: li.taxableAmount,
            vatRate: li.vatRate,
            vatAmount: li.vatAmount,
            totalAmount: li.totalAmount,
            hsOrServiceCode: li.hsOrServiceCode,
          })),
        },
      },
      include: { lineItems: true },
    });
    // Same queue send path as hub flow.
    await invoiceQueue.add("signInvoice", { ...validated, dbInvoiceId: rawNewInvoice.id });
    await prisma.tenant.update({ where: { id: tenantId }, data: { monthlyUsed: { increment: 1 }, lastSyncAt: new Date() } });
    res.status(202).json({
      success: true,
      ResponseCode: "09",
      ResponseDescription: "Transaction accepted, pending authorization",
      transactionRef: validated.clientInvoiceNumber,
      paymentId: rawNewInvoice.id,
      status: "PENDING_NRS_STAMP",
      merchantCode: tenantId,
      message: "Poll GET /api/v1/transactions/status/:transactionRef for authorization result.",
    });
  } catch (e: any) {
    if (e.name === "ZodError") {
      return res.status(400).json({ success: false, ResponseCode: "30", error: "Validation failed", details: e.errors });
    }
    res.status(500).json({ success: false, ResponseCode: "96", error: e.message });
  }
});

// GET /api/v1/transactions/status/:transactionRef
router.get("/api/v1/transactions/status/:transactionRef", async (req, res) => {
  try {
    const tenantId = await resolveMerchantTenant(req);
    const where: any = { clientInvoiceId: req.params.transactionRef };
    if (tenantId) where.tenantId = tenantId;
    const inv = await prisma.invoice.findFirst({ where, include: { lineItems: true } });
    if (!inv) return res.status(404).json({ success: false, ResponseCode: "25", error: "Transaction not found" });
    const rc = toResponseCode(inv.status);
    res.json({
      success: true,
      ResponseCode: rc.code,
      ResponseDescription: rc.description,
      transactionRef: inv.clientInvoiceId,
      paymentId: inv.id,
      status: inv.status,
      irn: inv.irn,
      csid: inv.csid,
      qrCodeUrl: inv.qrCodeUrl,
      ledgerWritebackStatus: inv.ledgerWritebackStatus,
      merchantCode: inv.tenantId,
      invoice: formatInvoice(inv),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, ResponseCode: "96", error: e.message });
  }
});

// GET /api/v1/merchants/:merchantCode/transactions — paged list
router.get("/api/v1/merchants/:merchantCode/transactions", async (req, res) => {
  try {
    const authed = await resolveMerchantTenant(req);
    const merchantCode = req.params.merchantCode;
    if (authed && authed !== merchantCode) {
      return res.status(403).json({ success: false, error: "Forbidden for this merchant" });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: merchantCode } });
    if (!tenant) return res.status(404).json({ success: false, error: "Merchant not found" });
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { tenantId: merchantCode };
    if (req.query.status) where.status = req.query.status;
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({ where, include: { lineItems: true }, orderBy: { createdAt: "desc" }, skip, take }),
    ]);
    res.json({ success: true, data: rows.map(formatInvoice), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/v1/transactions/refund — credit note against original IRN via same schema + queue
router.post("/api/v1/transactions/refund", async (req, res) => {
  try {
    const tenantId = await resolveMerchantTenant(req);
    if (!tenantId) return res.status(401).json({ success: false, ResponseCode: "07", error: "Missing or invalid credentials." });
    const originalRef = req.body?.transactionRef || req.body?.originalIrn || req.body?.original_irn;
    if (!originalRef) return res.status(400).json({ success: false, ResponseCode: "30", error: "transactionRef (original) is required" });
    const original = await prisma.invoice.findFirst({
      where: { tenantId, OR: [{ clientInvoiceId: String(originalRef) }, { irn: String(originalRef) }] },
      include: { lineItems: true },
    });
    if (!original) return res.status(404).json({ success: false, ResponseCode: "25", error: "Original transaction not found" });
    if (!original.irn) return res.status(400).json({ success: false, ResponseCode: "54", error: "Original transaction has no IRN yet — cannot refund" });
    const suffix = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-6) || "R01";
    const base = String(original.clientInvoiceId).replace(/[^A-Z0-9]/g, "").slice(0, 20) || "INV";
    const refundNumber = `${base}R${suffix}`.slice(0, 30);
    const validated = invoiceIngestionSchema.parse({
      tenantId,
      clientInvoiceNumber: refundNumber,
      invoiceType: "CREDIT_NOTE",
      invoiceKind: original.invoiceKind as any,
      issueDate: new Date().toISOString().substring(0, 10),
      customerCode: original.customerCode,
      customerName: original.customerName,
      customerTin: original.customerTin,
      originalIrn: original.irn,
      lineItems: original.lineItems.map((li: any) => ({
        itemCode: li.itemCode,
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        hsOrServiceCode: li.hsOrServiceCode,
        vatRate: Number(li.vatRate),
      })),
    } as any);
    const created = await prisma.invoice.create({
      data: {
        tenantId,
        clientInvoiceId: validated.clientInvoiceNumber,
        invoiceType: validated.invoiceType,
        invoiceKind: validated.invoiceKind,
        issueDate: new Date(validated.issueDate),
        customerCode: validated.customerCode,
        customerName: validated.customerName,
        customerTin: (validated as any).customerTin || null,
        currency: "NGN",
        subtotal: validated.subtotal,
        taxAmount: validated.totalVat,
        totalAmount: validated.grandTotal,
        status: "PENDING_NRS_STAMP",
        ledgerWritebackStatus: "PENDING",
        lineItems: {
          create: validated.lineItems.map((li: any) => ({
            itemCode: li.itemCode,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            taxableAmount: li.taxableAmount,
            vatRate: li.vatRate,
            vatAmount: li.vatAmount,
            totalAmount: li.totalAmount,
            hsOrServiceCode: li.hsOrServiceCode,
          })),
        },
      },
      include: { lineItems: true },
    });
    await invoiceQueue.add("signInvoice", { ...validated, dbInvoiceId: created.id });
    res.status(202).json({
      success: true,
      ResponseCode: "09",
      ResponseDescription: "Refund accepted, pending authorization",
      transactionRef: created.clientInvoiceId,
      originalRef: original.clientInvoiceId,
      status: "PENDING_NRS_STAMP",
    });
  } catch (e: any) {
    if (e.name === "ZodError") {
      return res.status(400).json({ success: false, ResponseCode: "30", error: "Validation failed", details: e.errors });
    }
    res.status(500).json({ success: false, ResponseCode: "96", error: e.message });
  }
});

// POST /api/v1/merchants/:merchantCode/webhook — register default signed-callback URL
router.post("/api/v1/merchants/:merchantCode/webhook", async (req, res) => {
  try {
    const authed = await resolveMerchantTenant(req);
    const merchantCode = req.params.merchantCode;
    if (!authed || authed !== merchantCode) {
      return res.status(401).json({ success: false, error: "Invalid credentials for this merchant" });
    }
    const callbackUrl = req.body?.callbackUrl || req.body?.webhookUrl;
    if (!callbackUrl) return res.status(400).json({ success: false, error: "callbackUrl is required" });
    try {
      const parsed = new URL(String(callbackUrl));
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad-protocol");
    } catch {
      return res.status(400).json({ success: false, error: "callbackUrl must be a valid http(s) URL" });
    }
    await saveMerchantWebhookConfig(merchantCode, {
      callbackUrl: String(callbackUrl),
      webhookSecret: req.body?.webhookSecret || req.body?.webhook_secret,
    });
    res.status(201).json({
      success: true,
      merchantCode,
      callbackUrl: String(callbackUrl),
      signed: true,
      algorithm: "HMAC-SHA256",
      headers: ["X-Citta-Event", "X-Citta-Signature", "X-Citta-Timestamp"],
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/v1/merchants/:merchantCode/webhook — view registration (secret never exposed)
router.get("/api/v1/merchants/:merchantCode/webhook", async (req, res) => {
  try {
    const authed = await resolveMerchantTenant(req);
    const merchantCode = req.params.merchantCode;
    if (!authed || authed !== merchantCode) {
      return res.status(401).json({ success: false, error: "Invalid credentials for this merchant" });
    }
    const cfg = await getMerchantWebhookConfig(merchantCode);
    res.json({
      success: true,
      merchantCode,
      callbackUrl: cfg.url,
      hasCustomSecret: !!cfg.url && !!cfg.secret,
      signed: true,
      algorithm: "HMAC-SHA256",
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/v1/webhooks/retry/:transactionRef — manually re-fire signed callback
router.post("/api/v1/webhooks/retry/:transactionRef", async (req, res) => {
  try {
    const tenantId = await resolveMerchantTenant(req);
    if (!tenantId) return res.status(401).json({ success: false, error: "Missing or invalid credentials." });
    const where: any = { tenantId, clientInvoiceId: req.params.transactionRef };
    const inv: any = await prisma.invoice.findFirst({ where });
    if (!inv) return res.status(404).json({ success: false, error: "Transaction not found" });
    const event = inv.status === "REJECTED" || inv.status === "CANCELLED" ? "invoice.rejected" : "invoice.authorized";
    const result = await dispatchMerchantWebhook(tenantId, inv.id, event as any);
    res.json({ success: result.delivered, merchantCode: tenantId, transactionRef: inv.clientInvoiceId, event, delivery: result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/v1/webhooks/verify — dev helper: recompute signature for a payload
router.post("/api/v1/webhooks/verify", async (req, res) => {
  try {
    const { payload, signature, secret, merchantCode } = req.body || {};
    if (payload === undefined || !signature) {
      return res.status(400).json({ success: false, error: "payload and signature are required" });
    }
    let key = secret;
    if (!key && merchantCode) {
      const cfg = await getMerchantWebhookConfig(String(merchantCode));
      key = cfg.secret;
    }
    if (!key) return res.status(400).json({ success: false, error: "secret (or merchantCode with a configured secret) is required" });
    const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
    res.json({ success: true, valid: verifyWebhookSignature(rawBody, String(signature), String(key)) });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/v1/openapi.json — machine-readable contract for the v1 gateway
router.get("/api/v1/openapi.json", (_req, res) => {
  res.json(openApiV1Spec);
});

export default router;
