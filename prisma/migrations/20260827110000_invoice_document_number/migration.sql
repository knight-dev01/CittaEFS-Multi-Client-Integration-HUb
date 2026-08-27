-- Spec: "Document Number" (optional, sequential document reference for audit
-- and tracking) is distinct from the mandatory "Invoice Number"
-- (clientInvoiceId). There was previously no column to hold a genuinely
-- different value -- cittaEfsClient.ts just aliased it to clientInvoiceId.
ALTER TABLE "invoices" ADD COLUMN "document_number" TEXT;
