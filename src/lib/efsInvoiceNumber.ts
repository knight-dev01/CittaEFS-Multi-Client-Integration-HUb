/**
 * CittaEFS accepts invoice numbers made of A-Z and 0-9 only ("Invoice Number:
 * Required, unique, A-Z and 0-9 only" - CittaEFS API documentation). ERPs use
 * other characters: QuickBooks "INV-1001", Odoo "INV/2026/00012". The hub keeps
 * the ERP's number everywhere (writeback, emails, UI) and sends EFS this form.
 * The original travels to EFS as documentNumber and comes back as sourceNbr.
 *
 *   "INV-1001"       -> "INV1001"
 *   "INV/2026/00012" -> "INV202600012"
 *   "rinv_7"         -> "RINV7"
 *
 * Keep in sync with the SQL expression index in
 * prisma/migrations/20261117100000_efs_invoice_number_index.
 */
export function toEfsInvoiceNumber(clientInvoiceNumber: string | null | undefined): string {
  const raw = String(clientInvoiceNumber ?? "").trim();
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Nothing usable left (e.g. Odoo draft "/"): send the original so EFS returns
  // a clear validation error instead of a blank number.
  return cleaned || raw;
}
