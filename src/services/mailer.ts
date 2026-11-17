import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/**
 * Outbound email over SMTP. Configure with:
 *   SMTP_HOST, SMTP_PORT (587 STARTTLS | 465 TLS), SMTP_SECURE ("true" for 465),
 *   SMTP_USER, SMTP_PASS, MAIL_FROM ("CittaEFS <no-reply@yourdomain.com>").
 * Mail is send-only: no Reply-To is offered, and auto-reply / out-of-office
 * responders are told not to answer.
 * When any required value is missing, isMailConfigured() is false and callers skip sending.
 */

export interface OutboundMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

let cached: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim() &&
      process.env.MAIL_FROM?.trim(),
  );
}

function getTransport(): Transporter {
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT || 587);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS! },
    // Never let message content pull local files or remote URLs into the mail.
    disableFileAccess: true,
    disableUrlAccess: true,
  } as any);
  return cached;
}

export async function sendMail(mail: OutboundMail): Promise<{ messageId: string }> {
  if (!isMailConfigured()) throw new Error("SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM)");
  const info = await getTransport().sendMail({
    from: process.env.MAIL_FROM!.trim(),
    to: mail.to.join(", "),
    ...(process.env.MAIL_BCC?.trim() ? { bcc: process.env.MAIL_BCC.trim() } : {}),
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return { messageId: String(info.messageId || "") };
}
