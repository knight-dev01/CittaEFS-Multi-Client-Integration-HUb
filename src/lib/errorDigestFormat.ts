/**
 * Pure formatting for the EFS feedback emails (errors and approvals) (no database access), so it
 * can be unit tested and reused by the tenant settings validation.
 */

const CATEGORY_GUIDE: Record<string, { title: string; action: string }> = {
  MISSING_HS_CODE: {
    title: "Missing or invalid HS / service code",
    action: "Give the product a valid HS or service code (on the item in your ERP, or in the Items mapping on CittaEFS), then resend the invoice.",
  },
  INVALID_TIN_FORMAT: {
    title: "Invalid customer TIN",
    action: "Correct the customer's Tax Identification Number on the customer record in your ERP, then resend the invoice.",
  },
  EFS_FORMAT: {
    title: "Invoice data CittaEFS cannot accept",
    action: "The hub checked this invoice against CittaEFS's rules before sending it. Correct the items listed below in your ERP, then resend the invoice.",
  },
  TAX_MISMATCH: {
    title: "Amounts do not add up",
    action: "CittaEFS requires taxable amount = quantity x unit price - line discount, and tax = taxable amount x VAT rate. Correct the line in your ERP, then resend the invoice.",
  },
  INVALID_DATE: {
    title: "Invalid issue date",
    action: "Set a real issue date (not in the future) on the invoice in your ERP, then resend it.",
  },
  GATEWAY_REJECTED: {
    title: "Rejected by CittaEFS / NRS",
    action: "Review the reason below, correct the invoice in your ERP, and resend it.",
  },
};

const ERP_LABEL: Record<string, string> = { qbo: "QuickBooks Online", odoo: "Odoo", excel: "Excel upload" };

export interface DigestError {
  id: string;
  clientInvoiceNumber: string;
  errorCategory: string;
  fieldAffected: string;
  errorMessage: string;
  sourceErp: string | null;
  createdAt: Date;
}

export interface DigestTenant {
  id: string;
  companyName: string;
}

function escapeHtml(v: string): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function guideFor(category: string) {
  return CATEGORY_GUIDE[category] || { title: category.replace(/_/g, " ").toLowerCase(), action: "Review the reason below and correct the invoice in your ERP, then resend it." };
}

function fmtTime(d: Date): string {
  return new Date(d).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}

/** Pure: builds the subject/text/html for one tenant's digest. */
export function buildDigestEmail(tenant: DigestTenant, errors: DigestError[], hubUrl?: string, omittedCount = 0) {
  const total = errors.length + omittedCount;
  const invoiceCount = new Set(errors.map(e => e.clientInvoiceNumber)).size;
  const subject = `[CittaEFS] ${total} invoice issue${total === 1 ? "" : "s"} need attention - ${tenant.companyName}`;

  const groups = new Map<string, DigestError[]>();
  for (const e of errors) {
    const list = groups.get(e.errorCategory) || [];
    list.push(e);
    groups.set(e.errorCategory, list);
  }

  const textParts: string[] = [
    `Hello ${tenant.companyName},`,
    "",
    `${total} issue(s) across ${invoiceCount} invoice(s) stopped invoices from being registered with CittaEFS / NRS. They have not been sent and need a correction.`,
    "",
  ];
  const htmlSections: string[] = [];

  for (const [category, list] of groups) {
    const g = guideFor(category);
    textParts.push(`== ${g.title} (${list.length}) ==`, `What to do: ${g.action}`);
    for (const e of list) {
      textParts.push(`- Invoice ${e.clientInvoiceNumber} [${ERP_LABEL[e.sourceErp || ""] || e.sourceErp || "unknown source"}] ${e.fieldAffected}: ${e.errorMessage} (${fmtTime(e.createdAt)})`);
    }
    textParts.push("");

    const rows = list
      .map(
        e => `<tr>
<td style="padding:8px;border-bottom:1px solid #e5e7eb;font-family:monospace;white-space:nowrap">${escapeHtml(e.clientInvoiceNumber)}</td>
<td style="padding:8px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${escapeHtml(ERP_LABEL[e.sourceErp || ""] || e.sourceErp || "-")}</td>
<td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(e.fieldAffected)}</td>
<td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(e.errorMessage.slice(0, 600))}</td>
<td style="padding:8px;border-bottom:1px solid #e5e7eb;white-space:nowrap;color:#6b7280">${escapeHtml(fmtTime(e.createdAt))}</td>
</tr>`,
      )
      .join("");
    htmlSections.push(`<h3 style="margin:24px 0 4px;font-size:15px;color:#111827">${escapeHtml(g.title)} <span style="color:#6b7280;font-weight:normal">(${list.length})</span></h3>
<p style="margin:0 0 8px;font-size:13px;color:#374151"><b>What to do:</b> ${escapeHtml(g.action)}</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;color:#111827">
<thead><tr style="background:#f3f4f6;text-align:left">
<th style="padding:8px">Invoice</th><th style="padding:8px">Source</th><th style="padding:8px">Field</th><th style="padding:8px">Reason</th><th style="padding:8px">When</th>
</tr></thead><tbody>${rows}</tbody></table>`);
  }

  if (omittedCount > 0) {
    textParts.push(`...and ${omittedCount} more issue(s). Open CittaEFS to see them all.`, "");
  }
  if (hubUrl) textParts.push(`Open CittaEFS: ${hubUrl}`, "");
  textParts.push("Once corrected in your ERP, the invoice is picked up again automatically, or you can resend it from CittaEFS.", "", "- CittaEFS", "", "This is an automated message from CittaEFS. Please do not reply - replies to this address are not monitored.");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">
<h2 style="margin:0 0 8px;font-size:18px;color:#111827">${total} invoice issue${total === 1 ? "" : "s"} need attention</h2>
<p style="margin:0 0 4px;font-size:14px;color:#374151">Hello ${escapeHtml(tenant.companyName)},</p>
<p style="margin:0;font-size:14px;color:#374151">The issues below stopped <b>${invoiceCount}</b> invoice${invoiceCount === 1 ? "" : "s"} from being registered with CittaEFS / NRS. They have <b>not</b> been sent and need a correction.</p>
${htmlSections.join("\n")}
${omittedCount > 0 ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">...and ${omittedCount} more issue(s). Open CittaEFS to see them all.</p>` : ""}
${hubUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(hubUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Open CittaEFS</a></p>` : ""}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">Once corrected in your ERP, the invoice is picked up again automatically, or you can resend it from CittaEFS. You receive this email only when CittaEFS reports new issues.<br/><br/>This is an automated message from CittaEFS. Please do not reply - replies to this address are not monitored.</p>
</div></body></html>`;

  return { subject, text: textParts.join("\n"), html };
}

export interface DigestApproval {
  clientInvoiceId: string;
  customerName: string;
  totalAmount: number;
  currency: string;
  irn: string;
  sourceErp: string | null;
  updatedAt: Date;
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: currency || "NGN" }).format(amount);
  } catch {
    return `${currency || ""} ${Number(amount).toFixed(2)}`.trim();
  }
}

/** Pure: builds the subject/text/html for one tenant's "invoices approved" summary. */
export function buildApprovalDigestEmail(tenant: DigestTenant, approvals: DigestApproval[], hubUrl?: string, omittedCount = 0) {
  const total = approvals.length + omittedCount;
  const subject = `[CittaEFS] ${total} invoice${total === 1 ? "" : "s"} approved by NRS - ${tenant.companyName}`;
  const erp = (a: DigestApproval) => ERP_LABEL[a.sourceErp || ""] || a.sourceErp || "-";

  const textParts: string[] = [
    `Hello ${tenant.companyName},`,
    "",
    `${total} invoice(s) were registered with CittaEFS / NRS and issued an IRN. The IRN and QR code have been written back to your ERP.`,
    "",
  ];
  for (const a of approvals) {
    textParts.push(`- Invoice ${a.clientInvoiceId} [${erp(a)}] ${a.customerName} ${fmtMoney(a.totalAmount, a.currency)} - IRN ${a.irn} (${fmtTime(a.updatedAt)})`);
  }
  textParts.push("");
  if (omittedCount > 0) textParts.push(`...and ${omittedCount} more. Open CittaEFS to see them all.`, "");
  if (hubUrl) textParts.push(`Open CittaEFS: ${hubUrl}`, "");
  textParts.push("No action is needed.", "", "- CittaEFS", "", "This is an automated message from CittaEFS. Please do not reply - replies to this address are not monitored.");

  const td = 'style="padding:8px;border-bottom:1px solid #e5e7eb"';
  const rows = approvals
    .map(
      a => `<tr>
<td ${td.replace('"', '"font-family:monospace;white-space:nowrap;')}>${escapeHtml(a.clientInvoiceId)}</td>
<td ${td.replace('"', '"white-space:nowrap;')}>${escapeHtml(erp(a))}</td>
<td ${td}>${escapeHtml(a.customerName)}</td>
<td ${td.replace('"', '"white-space:nowrap;text-align:right;')}>${escapeHtml(fmtMoney(a.totalAmount, a.currency))}</td>
<td ${td.replace('"', '"font-family:monospace;font-size:12px;word-break:break-all;')}>${escapeHtml(a.irn)}</td>
<td ${td.replace('"', '"white-space:nowrap;color:#6b7280;')}>${escapeHtml(fmtTime(a.updatedAt))}</td>
</tr>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">
<h2 style="margin:0 0 8px;font-size:18px;color:#111827">${total} invoice${total === 1 ? "" : "s"} approved by NRS</h2>
<p style="margin:0 0 4px;font-size:14px;color:#374151">Hello ${escapeHtml(tenant.companyName)},</p>
<p style="margin:0 0 16px;font-size:14px;color:#374151">These invoices were registered with CittaEFS / NRS and issued an IRN. The IRN and QR code have been written back to your ERP. <b>No action is needed.</b></p>
<table style="width:100%;border-collapse:collapse;font-size:13px;color:#111827">
<thead><tr style="background:#f3f4f6;text-align:left">
<th style="padding:8px">Invoice</th><th style="padding:8px">Source</th><th style="padding:8px">Customer</th><th style="padding:8px;text-align:right">Amount</th><th style="padding:8px">IRN</th><th style="padding:8px">When</th>
</tr></thead><tbody>${rows}</tbody></table>
${omittedCount > 0 ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">...and ${omittedCount} more. Open CittaEFS to see them all.</p>` : ""}
${hubUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(hubUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Open CittaEFS</a></p>` : ""}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">You receive this summary at most once an hour, only when invoices were approved.<br/><br/>This is an automated message from CittaEFS. Please do not reply - replies to this address are not monitored.</p>
</div></body></html>`;

  return { subject, text: textParts.join("\n"), html };
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => EMAIL_RE.test(s))));
}

