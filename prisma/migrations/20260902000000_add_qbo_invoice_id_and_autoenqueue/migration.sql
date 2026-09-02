-- AlterTable: add qbo_invoice_id to invoices, auto_enqueue_qbo to tenant_erps
ALTER TABLE "invoices" ADD COLUMN "qbo_invoice_id" TEXT;
CREATE INDEX IF NOT EXISTS "invoices_qbo_invoice_id_idx" ON "invoices"("qbo_invoice_id");
ALTER TABLE "tenant_erps" ADD COLUMN "auto_enqueue_qbo" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: for existing QBO-sourced rows where client_invoice_id is numeric Id but document_number holds DocNumber,
-- promote DocNumber to client_invoice_id and preserve Id in qbo_invoice_id.
-- Heuristic: numeric-only client_invoice_id with non-empty document_number and source_erp='qbo' or queue payload hints
UPDATE "invoices"
SET "qbo_invoice_id" = "client_invoice_id",
    "client_invoice_id" = "document_number"
WHERE "document_number" IS NOT NULL
  AND "document_number" <> ''
  AND "client_invoice_id" ~ '^[0-9]+$'
  AND ("source_erp" = 'qbo' OR "source_erp" = 'QBO' OR "qbo_invoice_id" IS NULL);

-- Also handle any remaining numeric client_invoice_id rows that look like QBO Ids (even without source_erp)
-- by moving document_number if present — safe because Excel DocNumbers are never pure numeric without prefix
-- For those still conflicting on UNIQUE(tenant_id, client_invoice_id), keep first row and append suffix
-- (De-duplicate after promotion: if tenant already has that DocNumber, keep first, suffix second)
DO $$
DECLARE
  r RECORD;
  dup_count INT;
BEGIN
  FOR r IN
    SELECT id, tenant_id, client_invoice_id FROM invoices
    WHERE qbo_invoice_id IS NOT NULL
  LOOP
    SELECT COUNT(*) INTO dup_count FROM invoices
    WHERE tenant_id = r.tenant_id AND client_invoice_id = r.client_invoice_id AND id <> r.id;
    IF dup_count > 0 THEN
      UPDATE invoices SET client_invoice_id = client_invoice_id || '-QBO-' || substring(qbo_invoice_id from 1 for 6)
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
