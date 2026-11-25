import crypto from "crypto";

/**
 * A public, unguessable link to a stamped invoice's NRS QR code, hosted by the
 * hub, so people working in QuickBooks or Odoo can open, print or download the
 * QR without a CittaEFS login. The link carries the hub invoice id plus an HMAC
 * of it, so ids cannot be enumerated and nothing needs storing.
 *
 * Needs a persistent JWT_SECRET (links must survive restarts) and the hub's
 * public API address (HUB_API_PUBLIC_URL, or RENDER_EXTERNAL_URL which Render
 * sets itself). Without either, no link is made and the writeback says the QR
 * is attached instead.
 */

function secret(): string | null {
  const s = process.env.JWT_SECRET?.trim();
  return s ? `qr-link:${s}` : null;
}

function signature(invoiceId: string, key: string): string {
  return crypto.createHmac("sha256", key).update(invoiceId).digest("base64url").slice(0, 22);
}

/** "<invoiceId>.<signature>", or null without a persistent secret. */
export function qrToken(invoiceId: string): string | null {
  const key = secret();
  return key ? `${invoiceId}.${signature(invoiceId, key)}` : null;
}

/** The invoice id a token was signed for, or null when it is forged or malformed. */
export function invoiceIdFromQrToken(token: string): string | null {
  const key = secret();
  const dot = token.lastIndexOf(".");
  if (!key || dot <= 0) return null;
  const invoiceId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(invoiceId, key));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? invoiceId : null;
}

export function hubPublicApiUrl(): string | null {
  const base = (process.env.HUB_API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? base : null;
}

/** The QR page link for a hub invoice, or null when the hub cannot make one. */
export function qrLinkFor(invoiceId: string | null | undefined): string | null {
  const base = hubPublicApiUrl();
  const token = invoiceId ? qrToken(invoiceId) : null;
  return base && token ? `${base}/qr/${token}` : null;
}
