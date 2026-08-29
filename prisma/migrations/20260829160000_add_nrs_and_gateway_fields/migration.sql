-- Add NRS gateway and Nigeria NRS MBS fields missing in production (Render Neon)
-- Tenant: single shared gateway + ERP config
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "citta_gateway_url" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "citta_writeback_target" TEXT DEFAULT 'HUB';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "erp_config" TEXT;

-- Customer: NRS address enrichment
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "cc_email" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "postcode" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "country_code" TEXT DEFAULT 'NGA';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "state_code" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "local_government_code" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "citta_customer_id" TEXT;

-- Item: NRS taxonomy
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "tax_category_code" TEXT;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "product_category" TEXT;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "is_service" BOOLEAN DEFAULT false;

-- Invoice: header-level NRS fields
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "header_discount" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "header_charges" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "callback_url" TEXT;
