import type { Transporter } from "nodemailer";

/**
 * Outbound email over SMTP. Configure with:
 *   SMTP_HOST, SMTP_PORT (587 STARTTLS | 465 TLS), SMTP_SECURE ("true" for 465),
 *   SMTP_USER, SMTP_PASS, MAIL_FROM ("CittaEFS <no-reply@yourdomain.com>").
 * Mail is send-only: no Reply-To is offered, and auto-reply / out-of-office
 * responders are told not to answer.
 * Or set BREVO_API_KEY (+ MAIL_FROM) to send over Brevo's HTTPS API instead -
 * needed on hosts that block outbound SMTP ports, such as Render free instances.
 * When any required value is missing, isMailConfigured() is false and callers skip sending.
 */

export interface OutboundMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

let cached: Transporter | null = null;

/** Brevo's HTTPS email API: works where hosts block outbound SMTP ports (e.g. Render free instances). */
function useBrevoApi(): boolean {
  return Boolean(process.env.BREVO_API_KEY?.trim());
}

export function isMailConfigured(): boolean {
  if (!process.env.MAIL_FROM?.trim()) return false;
  if (useBrevoApi()) return true;
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

export const MAIL_SETTINGS_HINT = "MAIL_FROM plus either BREVO_API_KEY, or SMTP_HOST, SMTP_USER and SMTP_PASS";

/** "CittaEFS <no-reply@x.com>" -> { name: "CittaEFS", email: "no-reply@x.com" } */
export function parseMailFrom(from: string): { name?: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { ...(m[1].trim() ? { name: m[1].trim() } : {}), email: m[2].trim() };
  return { email: from.trim() };
}

const AUTO_HEADERS = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
  Precedence: "bulk",
};

async function sendViaBrevo(mail: OutboundMail): Promise<{ messageId: string }> {
  const bcc = process.env.MAIL_BCC?.trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "api-key": process.env.BREVO_API_KEY!.trim(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: parseMailFrom(process.env.MAIL_FROM!),
        to: mail.to.map(email => ({ email })),
        ...(bcc ? { bcc: [{ email: bcc }] } : {}),
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
        headers: AUTO_HEADERS,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Brevo rejected the email (${res.status}): ${body?.message || body?.code || "unknown error"}`);
    return { messageId: String(body?.messageId || "") };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("Brevo email API timed out after 20s");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getTransport(): Promise<Transporter> {
  if (cached) return cached;
  // Loaded on first send, not at startup: if the library cannot load on this
  // Node version, only sending fails (with the real reason) instead of leaving
  // the feedback-email modules half-initialised.
  const mod: any = await import("nodemailer");
  const nodemailer = mod.default ?? mod;
  const port = Number(process.env.SMTP_PORT || 587);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS! },
    // Never let message content pull local files or remote URLs into the mail.
    disableFileAccess: true,
    disableUrlAccess: true,
    // Fail in seconds, not minutes, when the host blocks SMTP ports.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  } as any);
  return cached;
}

export async function sendMail(mail: OutboundMail): Promise<{ messageId: string }> {
  if (!isMailConfigured()) throw new Error(`Email is not configured (${MAIL_SETTINGS_HINT})`);
  if (useBrevoApi()) return sendViaBrevo(mail);
  const info = await (await getTransport()).sendMail({
    from: process.env.MAIL_FROM!.trim(),
    to: mail.to.join(", "),
    ...(process.env.MAIL_BCC?.trim() ? { bcc: process.env.MAIL_BCC.trim() } : {}),
    headers: AUTO_HEADERS,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return { messageId: String(info.messageId || "") };
}
