-- Spec answer: duplicate-invoice detection is "critical". clientInvoiceId was
-- only indexed, not unique, so nothing at the database level stopped the same
-- client invoice number being ingested twice for a tenant. Enforce it.
DROP INDEX "invoices_tenant_id_client_invoice_id_idx";

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_client_invoice_id_key" UNIQUE ("tenant_id", "client_invoice_id");
