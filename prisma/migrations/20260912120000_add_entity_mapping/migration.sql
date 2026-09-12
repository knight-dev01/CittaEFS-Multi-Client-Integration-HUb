-- CittaHub Revision Plan Phase 1: EntityMapping (thin-hub pivot)
-- CittaEFS has no customer/item registration API; this table tracks a
-- reference (source ERP id -> CittaEFS-issued code) instead of owning a
-- full local customer/item catalog. Customer/Item tables are kept as
-- deprecated for now (see schema.prisma comments) and are not touched here.

CREATE TABLE "entity_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "source_erp" TEXT NOT NULL,
    "source_erp_id" TEXT NOT NULL,
    "display_name" TEXT,
    "tin" TEXT,
    "details_json" TEXT,
    "citta_reference_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REGISTRATION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entity_mappings_tenant_id_entity_type_source_erp_id_key" ON "entity_mappings"("tenant_id", "entity_type", "source_erp_id");

CREATE INDEX "entity_mappings_tenant_id_status_idx" ON "entity_mappings"("tenant_id", "status");

ALTER TABLE "entity_mappings" ADD CONSTRAINT "entity_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
