-- Multi-ERP per company: TenantErp join table + sourceErp on invoices
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS "tenant_erps" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "platform_type" TEXT NOT NULL,
  "erp_id" TEXT NOT NULL,
  "display_name" TEXT,
  "config" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "last_sync_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_erps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_erps_tenant_id_platform_type_key" ON "tenant_erps"("tenant_id", "platform_type");
CREATE INDEX IF NOT EXISTS "tenant_erps_tenant_id_idx" ON "tenant_erps"("tenant_id");

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source_erp" TEXT;

-- Backfill: one TenantErp per existing Tenant based on legacy platformType
INSERT INTO "tenant_erps" ("id", "tenant_id", "platform_type", "erp_id", "display_name", "config", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", "platform_type",
  CASE 
    WHEN "platform_type" = 'QuickBooks Online' THEN 'qbo'
    WHEN "platform_type" LIKE '%Excel%' OR "platform_type" LIKE '%CSV%' THEN 'excel'
    WHEN "platform_type" = 'SAP S/4HANA' THEN 'sap'
    WHEN "platform_type" = 'NetSuite' THEN 'netsuite'
    WHEN "platform_type" = 'Odoo ERP' THEN 'odoo'
    ELSE 'generic'
  END,
  "platform_type",
  "erp_config",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants"
ON CONFLICT ("tenant_id", "platform_type") DO NOTHING;
