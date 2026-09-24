-- Add independent ERP columns (idempotent)
ALTER TABLE "tenant_erps" ADD COLUMN IF NOT EXISTS "company_id" TEXT;
CREATE INDEX IF NOT EXISTS "tenant_erps_company_id_idx" ON "tenant_erps"("company_id");
-- Drop old unique [tenantId, platformType] if exists, create new [tenantId, erpId, companyId]
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_erps_tenantId_platformType_key') THEN
    ALTER TABLE "tenant_erps" DROP CONSTRAINT "tenant_erps_tenantId_platformType_key";
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_erps_tenantId_erpId_companyId_key" ON "tenant_erps"("tenant_id", "erp_id", "company_id");
-- Invoices per-connection tracking
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "tenant_erp_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "company_id" TEXT;
CREATE INDEX IF NOT EXISTS "invoices_company_id_idx" ON "invoices"("company_id");
CREATE INDEX IF NOT EXISTS "invoices_tenant_erp_id_idx" ON "invoices"("tenant_erp_id");
-- Integrations independent: drop old unique, create new with companyId
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integrations_tenantId_sourceSystem_key') THEN
    ALTER TABLE "integrations" DROP CONSTRAINT "integrations_tenantId_sourceSystem_key";
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_tenantId_sourceSystem_companyId_key" ON "integrations"("tenant_id", "source_system", "company_id");
CREATE INDEX IF NOT EXISTS "integrations_company_id_idx" ON "integrations"("company_id");
