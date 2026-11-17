-- CittaEFS invoice numbers are the A-Z/0-9 form of the ERP's number
-- (src/lib/efsInvoiceNumber.ts). Webhooks are matched back with this same
-- expression, so index it to keep that lookup fast.
CREATE INDEX IF NOT EXISTS "invoices_efs_invoice_number_idx"
  ON "invoices" (UPPER(regexp_replace("client_invoice_id", '[^A-Za-z0-9]', '', 'g')));
