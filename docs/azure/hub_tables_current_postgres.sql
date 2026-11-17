-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "platform_type" TEXT NOT NULL,
    "market_tier" TEXT NOT NULL,
    "citta_api_key" TEXT NOT NULL,
    "encrypted_secret" TEXT,
    "onboarding_status" TEXT NOT NULL,
    "monthly_allowance" INTEGER NOT NULL DEFAULT 1000,
    "monthly_used" INTEGER NOT NULL DEFAULT 0,
    "default_vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 7.5,
    "citta_gateway_url" TEXT,
    "citta_mode" TEXT NOT NULL DEFAULT 'live',
    "citta_other_mode_config" TEXT,
    "citta_writeback_target" TEXT NOT NULL DEFAULT 'BOTH',
    "erp_config" TEXT,
    "last_sync_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_erps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "platform_type" TEXT NOT NULL,
    "erp_id" TEXT NOT NULL,
    "company_id" TEXT,
    "display_name" TEXT,
    "config" TEXT,
    "auto_enqueue_qbo" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_erps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_system_cust_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "email" TEXT,
    "cc_email" TEXT,
    "postcode" TEXT,
    "tax_id" TEXT,
    "tax_classification" TEXT NOT NULL DEFAULT 'B2B',
    "street" TEXT,
    "city" TEXT,
    "country" TEXT,
    "country_code" TEXT NOT NULL DEFAULT 'NGA',
    "state_code" TEXT,
    "local_government_code" TEXT,
    "citta_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_sku" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT NOT NULL,
    "unit_code" TEXT NOT NULL DEFAULT 'EA',
    "hs_or_service_code" TEXT NOT NULL,
    "category_type" TEXT NOT NULL DEFAULT 'GOODS',
    "default_vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 7.5,
    "tax_category_code" TEXT,
    "product_category" TEXT,
    "is_service" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_erp" TEXT,
    "tenant_erp_id" TEXT,
    "company_id" TEXT,
    "qbo_invoice_id" TEXT,
    "odoo_invoice_id" TEXT,
    "billing_reference_irns" TEXT,
    "client_invoice_id" TEXT NOT NULL,
    "document_number" TEXT,
    "invoice_type" TEXT NOT NULL DEFAULT 'STANDARD',
    "invoice_kind" TEXT NOT NULL DEFAULT 'B2B',
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "customer_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_tin" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax_amount" DOUBLE PRECISION NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "header_discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "header_charges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "callback_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_NRS_STAMP',
    "irn" TEXT,
    "csid" TEXT,
    "qr_code_url" TEXT,
    "pdf_signed_url" TEXT,
    "raw_payload_hash" TEXT,
    "ledger_writeback_status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "taxable_amount" DOUBLE PRECISION NOT NULL,
    "vat_rate" DOUBLE PRECISION NOT NULL,
    "vat_amount" DOUBLE PRECISION NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "hs_or_service_code" TEXT NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_errors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_invoice_number" TEXT NOT NULL,
    "error_category" TEXT NOT NULL,
    "field_affected" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "raw_payload_sample" TEXT NOT NULL,
    "source_erp" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_ref" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "sha256_payload_hash" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "raw_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "organization" TEXT NOT NULL DEFAULT 'CittaEFS Enterprise',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_number" TEXT,
    "irn" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature" TEXT,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_erps_tenant_id_idx" ON "tenant_erps"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_erps_company_id_idx" ON "tenant_erps"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_erps_tenant_id_erp_id_company_id_key" ON "tenant_erps"("tenant_id", "erp_id", "company_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_client_system_cust_id_idx" ON "customers"("tenant_id", "client_system_cust_id");

-- CreateIndex
CREATE INDEX "items_tenant_id_idx" ON "items"("tenant_id");

-- CreateIndex
CREATE INDEX "items_tenant_id_client_sku_idx" ON "items"("tenant_id", "client_sku");

-- CreateIndex
CREATE INDEX "entity_mappings_tenant_id_status_idx" ON "entity_mappings"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "entity_mappings_tenant_id_entity_type_source_erp_id_key" ON "entity_mappings"("tenant_id", "entity_type", "source_erp_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_irn_key" ON "invoices"("irn");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_company_id_idx" ON "invoices"("company_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_erp_id_idx" ON "invoices"("tenant_erp_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_client_invoice_id_key" ON "invoices"("tenant_id", "client_invoice_id");

-- CreateIndex
CREATE INDEX "validation_errors_tenant_id_idx" ON "validation_errors"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_sha256_payload_hash_idx" ON "audit_logs"("sha256_payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "integrations_tenant_id_idx" ON "integrations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tenant_id_source_system_key" ON "integrations"("tenant_id", "source_system");

-- CreateIndex
CREATE INDEX "queue_jobs_tenant_id_idx" ON "queue_jobs"("tenant_id");

-- CreateIndex
CREATE INDEX "queue_jobs_status_next_attempt_at_idx" ON "queue_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenant_id_received_at_idx" ON "webhook_deliveries"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_webhook_id_key" ON "webhook_deliveries"("webhook_id");

-- AddForeignKey
ALTER TABLE "tenant_erps" ADD CONSTRAINT "tenant_erps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mappings" ADD CONSTRAINT "entity_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_errors" ADD CONSTRAINT "validation_errors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_jobs" ADD CONSTRAINT "queue_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

