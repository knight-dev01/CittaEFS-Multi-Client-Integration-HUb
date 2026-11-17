import { prisma } from "../lib/prisma";
import { isMailConfigured, sendMail } from "../services/mailer";
import { buildDigestEmail, buildApprovalDigestEmail, parseRecipientList } from "../lib/errorDigestFormat";
import { getErpCompanyEmails } from "../services/erpContactEmail";
import { filterDeliverable, type EmailCheck } from "../services/emailVerify";
export { buildDigestEmail, buildApprovalDigestEmail, parseRecipientList } from "../lib/errorDigestFormat";

/**
 * EFS feedback emails, one packaged email per tenant:
 *   - runErrorDigestCron:    OPEN validation / gateway errors not yet emailed
 *                            (runs every few minutes so errors go out promptly)
 *   - runApprovalDigestCron: invoices approved with an IRN not yet emailed (hourly)
 * Rows are marked as notified only after the SMTP server accepts the message,
 * so a failed send is retried on the next run instead of being lost.
 *
 * Recipients: the tenant's Settings "Notification email" override, else the
 * company email from the connected ERP (QBO / Odoo), else the tenant's hub users.
 */

// Hub-side configuration problems are the operator's to fix, not the client's.
const INTERNAL_CATEGORIES = new Set(["GATEWAY_NOT_CONFIGURED"]);
const MAX_ROWS_PER_EMAIL = 200;
const APPROVED_STATUSES = ["APPROVED", "SIGNED", "TRANSMITTED"];

export type RecipientSource = "settings" | "erp" | "hub_users" | "none";
export interface RecipientResolution {
  source: RecipientSource;
  recipients: string[];
  /** Addresses skipped because the background check found them not real. */
  rejected: EmailCheck[];
  configured: string[];
  erpEmails: string[];
}

/**
 * Settings override -> ERP company email -> hub users. Every candidate is
 * checked (format + the domain accepts mail); a source whose addresses are all
 * invalid falls through to the next one, so feedback still reaches someone.
 */
export async function resolveRecipientsDetailed(tenantId: string, notificationEmail: string | null): Promise<RecipientResolution> {
  const configured = parseRecipientList(notificationEmail);
  const erpEmails = await getErpCompanyEmails(tenantId);
  const rejected: EmailCheck[] = [];
  const candidates: [RecipientSource, () => Promise<string[]>][] = [
    ["settings", async () => configured],
    ["erp", async () => erpEmails],
    ["hub_users", async () => {
      const users = await prisma.user.findMany({ where: { tenantId }, select: { email: true } });
      return parseRecipientList(users.map(u => u.email).join(","));
    }],
  ];
  for (const [source, load] of candidates) {
    const list = await load();
    if (!list.length) continue;
    const { deliverable, rejected: bad } = await filterDeliverable(list);
    rejected.push(...bad);
    if (bad.length) console.warn(`[FeedbackEmail] Tenant ${tenantId}: skipping ${source} address(es) that failed the email check: ${bad.map(b => `${b.email} (${b.reason})`).join("; ")}`);
    if (deliverable.length) return { source, recipients: deliverable, rejected, configured, erpEmails };
  }
  return { source: "none", recipients: [], rejected, configured, erpEmails };
}

export async function resolveRecipients(tenantId: string, notificationEmail: string | null): Promise<string[]> {
  return (await resolveRecipientsDetailed(tenantId, notificationEmail)).recipients;
}

export interface DigestReport {
  skipped?: string;
  tenantsEmailed: number;
  errorsEmailed: number;
  tenantsWithoutRecipients: string[];
  failures: { tenantId: string; error: string }[];
}

export async function runErrorDigestCron(opts: { tenantId?: string } = {}): Promise<DigestReport> {
  const report: DigestReport = { tenantsEmailed: 0, errorsEmailed: 0, tenantsWithoutRecipients: [], failures: [] };
  if (!isMailConfigured()) {
    report.skipped = "SMTP not configured";
    return report;
  }

  const pending = await prisma.validationError.findMany({
    where: {
      notifiedAt: null,
      status: "OPEN",
      errorCategory: { notIn: Array.from(INTERNAL_CATEGORIES) },
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, tenantId: true, clientInvoiceNumber: true, errorCategory: true, fieldAffected: true, errorMessage: true, sourceErp: true, createdAt: true },
  });
  if (!pending.length) return report;

  const byTenant = new Map<string, typeof pending>();
  for (const e of pending) {
    const list = byTenant.get(e.tenantId) || [];
    list.push(e);
    byTenant.set(e.tenantId, list);
  }

  const hubUrl = (process.env.HUB_PUBLIC_URL || process.env.APP_URL || "").trim() || undefined;

  for (const [tenantId, all] of byTenant) {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, companyName: true, notificationEmail: true } });
      if (!tenant) continue;
      const to = await resolveRecipients(tenantId, tenant.notificationEmail);
      if (!to.length) {
        // Left un-notified so they go out once a recipient is configured.
        report.tenantsWithoutRecipients.push(tenantId);
        continue;
      }
      const listed = all.slice(0, MAX_ROWS_PER_EMAIL);
      const omitted = all.length - listed.length;
      const mail = buildDigestEmail({ id: tenant.id, companyName: tenant.companyName }, listed, hubUrl, omitted);
      await sendMail({ to, ...mail });
      // Mark everything pending for this tenant: the omitted ones were counted in the email.
      await prisma.validationError.updateMany({ where: { id: { in: all.map(e => e.id) } }, data: { notifiedAt: new Date() } });
      report.tenantsEmailed += 1;
      report.errorsEmailed += all.length;
      console.log(`[ErrorDigest] Emailed ${all.length} issue(s) to ${to.length} recipient(s) for tenant ${tenantId}`);
    } catch (e: any) {
      report.failures.push({ tenantId, error: e?.message || String(e) });
      console.error(`[ErrorDigest] Failed for tenant ${tenantId}:`, e?.message);
    }
  }
  return report;
}

export async function runApprovalDigestCron(opts: { tenantId?: string } = {}): Promise<DigestReport> {
  const report: DigestReport = { tenantsEmailed: 0, errorsEmailed: 0, tenantsWithoutRecipients: [], failures: [] };
  if (!isMailConfigured()) {
    report.skipped = "SMTP not configured";
    return report;
  }

  const pending = await prisma.invoice.findMany({
    where: {
      feedbackNotifiedAt: null,
      status: { in: APPROVED_STATUSES },
      irn: { not: null },
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    },
    orderBy: { updatedAt: "asc" },
    select: { id: true, tenantId: true, clientInvoiceId: true, customerName: true, totalAmount: true, currency: true, irn: true, sourceErp: true, updatedAt: true },
  });
  if (!pending.length) return report;

  const byTenant = new Map<string, typeof pending>();
  for (const inv of pending) {
    const list = byTenant.get(inv.tenantId) || [];
    list.push(inv);
    byTenant.set(inv.tenantId, list);
  }

  const hubUrl = (process.env.HUB_PUBLIC_URL || process.env.APP_URL || "").trim() || undefined;

  for (const [tenantId, all] of byTenant) {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, companyName: true, notificationEmail: true } });
      if (!tenant) continue;
      const to = await resolveRecipients(tenantId, tenant.notificationEmail);
      if (!to.length) {
        report.tenantsWithoutRecipients.push(tenantId);
        continue;
      }
      const listed = all.slice(0, MAX_ROWS_PER_EMAIL).map(i => ({ ...i, irn: i.irn as string }));
      const mail = buildApprovalDigestEmail({ id: tenant.id, companyName: tenant.companyName }, listed, hubUrl, all.length - listed.length);
      await sendMail({ to, ...mail });
      await prisma.invoice.updateMany({ where: { id: { in: all.map(i => i.id) } }, data: { feedbackNotifiedAt: new Date() } });
      report.tenantsEmailed += 1;
      report.errorsEmailed += all.length;
      console.log(`[ApprovalDigest] Emailed ${all.length} approval(s) to ${to.length} recipient(s) for tenant ${tenantId}`);
    } catch (e: any) {
      report.failures.push({ tenantId, error: e?.message || String(e) });
      console.error(`[ApprovalDigest] Failed for tenant ${tenantId}:`, e?.message);
    }
  }
  return report;
}
