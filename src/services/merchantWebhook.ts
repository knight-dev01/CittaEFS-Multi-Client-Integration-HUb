import crypto from "crypto";
import { prisma } from "../lib/prisma";

export type MerchantWebhookEvent = "invoice.authorized" | "invoice.rejected";

export interface MerchantWebhookPayload {
  event: MerchantWebhookEvent;
  merchantCode: string;
  transactionRef: string;
  paymentId: string;
  status: string;
  ResponseCode: string;
  ResponseDescription: string;
  irn: string | null;
  qrCodeUrl: string | null;
  ledgerWritebackStatus: string;
  timestamp: string;
}

export interface WebhookDeliveryResult {
  delivered: boolean;
  httpStatus?: number;
  reason?: string;
}

// HMAC-SHA256 over the raw JSON body. Merchants recompute with their secret
// (own webhook secret, else the merchant API key) and compare timing-safe.
export function signWebhookPayload(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  try {
    const expected = signWebhookPayload(rawBody, secret);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(String(signature), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function readErpConfigBag(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

// Merchant-level defaults live inside the existing Tenant.erpConfig JSON bag
// (merged, never overwritten — same pattern as odooService config storage).
export async function getMerchantWebhookConfig(
  tenantId: string,
): Promise<{ url: string | null; secret: string | null }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { erpConfig: true, cittaApiKey: true },
  });
  if (!tenant) return { url: null, secret: null };
  const bag = readErpConfigBag(tenant.erpConfig);
  const url = bag.merchantWebhookUrl || bag.webhookUrl || null;
  const secret = bag.merchantWebhookSecret || tenant.cittaApiKey || null;
  return { url, secret };
}

export async function saveMerchantWebhookConfig(
  tenantId: string,
  input: { callbackUrl: string; webhookSecret?: string },
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { erpConfig: true } });
  if (!tenant) throw new Error("Merchant not found");
  const bag = readErpConfigBag(tenant.erpConfig);
  bag.merchantWebhookUrl = input.callbackUrl;
  if (input.webhookSecret) bag.merchantWebhookSecret = input.webhookSecret;
  await prisma.tenant.update({ where: { id: tenantId }, data: { erpConfig: JSON.stringify(bag) } });
}

export function buildMerchantWebhookPayload(
  event: MerchantWebhookEvent,
  invoice: { tenantId: string; clientInvoiceId: string; id: string; status: string; irn: string | null; qrCodeUrl: string | null; ledgerWritebackStatus: string },
): MerchantWebhookPayload {
  const authorized = event === "invoice.authorized";
  return {
    event,
    merchantCode: invoice.tenantId,
    transactionRef: invoice.clientInvoiceId,
    paymentId: invoice.id,
    status: invoice.status,
    ResponseCode: authorized ? "00" : "11",
    ResponseDescription: authorized ? "Approved" : "Rejected",
    irn: invoice.irn,
    qrCodeUrl: invoice.qrCodeUrl,
    ledgerWritebackStatus: invoice.ledgerWritebackStatus,
    timestamp: new Date().toISOString(),
  };
}

// Fire-and-forget safe: resolves false (never throws) when no callback is
// configured or delivery fails, so worker/cron flows are never blocked.
export async function dispatchMerchantWebhook(
  tenantId: string,
  invoiceId: string,
  event: MerchantWebhookEvent,
): Promise<WebhookDeliveryResult> {
  try {
    const invoice: any = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return { delivered: false, reason: "invoice-not-found" };
    const { url: defaultUrl, secret } = await getMerchantWebhookConfig(tenantId);
    const url = invoice.callbackUrl || defaultUrl;
    if (!url) return { delivered: false, reason: "no-callback-configured" };
    if (!secret) return { delivered: false, reason: "no-secret-configured" };
    const payload = buildMerchantWebhookPayload(event, invoice);
    const rawBody = JSON.stringify(payload);
    const signature = signWebhookPayload(rawBody, secret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Citta-Event": event,
          "X-Citta-Signature": signature,
          "X-Citta-Timestamp": payload.timestamp,
        },
        body: rawBody,
        signal: controller.signal as any,
      });
      const ok = res.status >= 200 && res.status < 300;
      return ok
        ? { delivered: true, httpStatus: res.status }
        : { delivered: false, httpStatus: res.status, reason: `http-${res.status}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    return { delivered: false, reason: e?.message?.slice(0, 200) || "delivery-error" };
  }
}
