BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[tenants] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [company_name] NVARCHAR(1000) NOT NULL,
    [tin] NVARCHAR(1000) NOT NULL,
    [market_tier] NVARCHAR(1000) NOT NULL,
    [onboarding_status] NVARCHAR(1000) NOT NULL CONSTRAINT [tenants_onboarding_status_df] DEFAULT 'PENDING',
    [default_vat_rate] FLOAT(53) NOT NULL CONSTRAINT [tenants_default_vat_rate_df] DEFAULT 7.5,
    [citta_mode] NVARCHAR(1000) NOT NULL CONSTRAINT [tenants_citta_mode_df] DEFAULT 'live',
    [citta_gateway_url] NVARCHAR(1000),
    [citta_api_key] NVARCHAR(max) NOT NULL,
    [citta_inactive_config] NVARCHAR(max),
    [citta_writeback_target] NVARCHAR(1000) NOT NULL CONSTRAINT [tenants_citta_writeback_target_df] DEFAULT 'BOTH',
    [monthly_allowance] INT NOT NULL CONSTRAINT [tenants_monthly_allowance_df] DEFAULT 1000,
    [monthly_used] INT NOT NULL CONSTRAINT [tenants_monthly_used_df] DEFAULT 0,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [tenants_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [tenants_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[erp_connections] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [erp] NVARCHAR(1000) NOT NULL,
    [company_id] NVARCHAR(1000),
    [display_name] NVARCHAR(1000),
    [config] NVARCHAR(max),
    [access_token] NVARCHAR(max),
    [refresh_token] NVARCHAR(max),
    [token_expires_at] DATETIME2,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [erp_connections_status_df] DEFAULT 'CONNECTED',
    [auto_enqueue] BIT NOT NULL CONSTRAINT [erp_connections_auto_enqueue_df] DEFAULT 1,
    [last_sync_at] DATETIME2,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [erp_connections_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [erp_connections_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [erp_connections_tenant_id_erp_company_id_key] UNIQUE NONCLUSTERED ([tenant_id],[erp],[company_id])
);

-- CreateTable
CREATE TABLE [dbo].[customer_refs] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [source_erp] NVARCHAR(1000) NOT NULL,
    [erp_customer_id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [tin] NVARCHAR(1000),
    [citta_ref] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [customer_refs_status_df] DEFAULT 'PENDING_REGISTRATION',
    [export_details] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [customer_refs_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [customer_refs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [customer_refs_tenant_id_erp_customer_id_key] UNIQUE NONCLUSTERED ([tenant_id],[erp_customer_id])
);

-- CreateTable
CREATE TABLE [dbo].[item_refs] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [sku] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000),
    [hs_or_service_code] NVARCHAR(1000),
    [is_service] BIT NOT NULL CONSTRAINT [item_refs_is_service_df] DEFAULT 0,
    [vat_rate] FLOAT(53) NOT NULL CONSTRAINT [item_refs_vat_rate_df] DEFAULT 7.5,
    [unit_code] NVARCHAR(1000) NOT NULL CONSTRAINT [item_refs_unit_code_df] DEFAULT 'EA',
    [created_at] DATETIME2 NOT NULL CONSTRAINT [item_refs_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [item_refs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [item_refs_tenant_id_sku_key] UNIQUE NONCLUSTERED ([tenant_id],[sku])
);

-- CreateTable
CREATE TABLE [dbo].[invoices] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [connection_id] NVARCHAR(1000),
    [source_erp] NVARCHAR(1000),
    [erp_record_id] NVARCHAR(1000),
    [client_invoice_id] NVARCHAR(1000) NOT NULL,
    [document_number] NVARCHAR(1000),
    [invoice_type] NVARCHAR(1000) NOT NULL CONSTRAINT [invoices_invoice_type_df] DEFAULT 'STANDARD',
    [invoice_type_code] NVARCHAR(1000),
    [invoice_kind] NVARCHAR(1000) NOT NULL CONSTRAINT [invoices_invoice_kind_df] DEFAULT 'B2B',
    [billing_reference_irns] NVARCHAR(max),
    [issue_date] DATETIME2 NOT NULL,
    [due_date] DATETIME2,
    [customer_code] NVARCHAR(1000) NOT NULL,
    [customer_name] NVARCHAR(1000) NOT NULL,
    [customer_tin] NVARCHAR(1000),
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [invoices_currency_df] DEFAULT 'NGN',
    [subtotal] FLOAT(53) NOT NULL,
    [tax_amount] FLOAT(53) NOT NULL,
    [total_amount] FLOAT(53) NOT NULL,
    [header_discount] FLOAT(53) NOT NULL CONSTRAINT [invoices_header_discount_df] DEFAULT 0,
    [header_charges] FLOAT(53) NOT NULL CONSTRAINT [invoices_header_charges_df] DEFAULT 0,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [invoices_status_df] DEFAULT 'PENDING_NRS_STAMP',
    [irn] NVARCHAR(1000),
    [csid] NVARCHAR(1000),
    [qr_code_url] NVARCHAR(max),
    [ledger_writeback_status] NVARCHAR(1000) NOT NULL CONSTRAINT [invoices_ledger_writeback_status_df] DEFAULT 'PENDING',
    [callback_url] NVARCHAR(max),
    [raw_payload_hash] NVARCHAR(1000),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [invoices_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [invoices_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [invoices_tenant_id_client_invoice_id_key] UNIQUE NONCLUSTERED ([tenant_id],[client_invoice_id])
);

-- CreateTable
CREATE TABLE [dbo].[invoice_line_items] (
    [id] NVARCHAR(1000) NOT NULL,
    [invoice_id] NVARCHAR(1000) NOT NULL,
    [line_num] INT NOT NULL,
    [item_code] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(max) NOT NULL,
    [quantity] FLOAT(53) NOT NULL,
    [unit_price] FLOAT(53) NOT NULL,
    [taxable_amount] FLOAT(53) NOT NULL,
    [vat_rate] FLOAT(53) NOT NULL,
    [vat_amount] FLOAT(53) NOT NULL,
    [total_amount] FLOAT(53) NOT NULL,
    [hs_or_service_code] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [invoice_line_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[validation_errors] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [client_invoice_number] NVARCHAR(1000) NOT NULL,
    [source_erp] NVARCHAR(1000),
    [error_category] NVARCHAR(1000) NOT NULL,
    [field_affected] NVARCHAR(1000) NOT NULL,
    [error_message] NVARCHAR(max) NOT NULL,
    [raw_payload_sample] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [validation_errors_status_df] DEFAULT 'OPEN',
    [dedupe_key] NVARCHAR(1000),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [validation_errors_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [validation_errors_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[audit_logs] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [action] NVARCHAR(1000) NOT NULL,
    [entity_type] NVARCHAR(1000) NOT NULL,
    [entity_ref] NVARCHAR(1000) NOT NULL,
    [details] NVARCHAR(max) NOT NULL,
    [sha256_payload_hash] NVARCHAR(1000) NOT NULL,
    [performed_by] NVARCHAR(1000) NOT NULL,
    [raw_json] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [audit_logs_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [audit_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000),
    [email] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [password_hash] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL CONSTRAINT [users_role_df] DEFAULT 'OPERATOR',
    [created_at] DATETIME2 NOT NULL CONSTRAINT [users_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[queue_jobs] (
    [id] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [job_name] NVARCHAR(1000) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL,
    [attempts] INT NOT NULL CONSTRAINT [queue_jobs_attempts_df] DEFAULT 0,
    [max_retries] INT NOT NULL CONSTRAINT [queue_jobs_max_retries_df] DEFAULT 5,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [queue_jobs_status_df] DEFAULT 'QUEUED',
    [last_error] NVARCHAR(max),
    [next_attempt_at] DATETIME2 NOT NULL CONSTRAINT [queue_jobs_next_attempt_at_df] DEFAULT CURRENT_TIMESTAMP,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [queue_jobs_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [queue_jobs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[webhook_deliveries] (
    [id] NVARCHAR(1000) NOT NULL,
    [webhook_id] NVARCHAR(1000) NOT NULL,
    [event_type] NVARCHAR(1000) NOT NULL,
    [tenant_id] NVARCHAR(1000) NOT NULL,
    [invoice_number] NVARCHAR(1000),
    [irn] NVARCHAR(1000),
    [signature] NVARCHAR(1000),
    [received_at] DATETIME2 NOT NULL CONSTRAINT [webhook_deliveries_received_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [webhook_deliveries_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [webhook_deliveries_webhook_id_key] UNIQUE NONCLUSTERED ([webhook_id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [customer_refs_tenant_id_status_idx] ON [dbo].[customer_refs]([tenant_id], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoices_tenant_id_status_idx] ON [dbo].[invoices]([tenant_id], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [validation_errors_tenant_id_status_idx] ON [dbo].[validation_errors]([tenant_id], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_tenant_id_created_at_idx] ON [dbo].[audit_logs]([tenant_id], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [queue_jobs_status_next_attempt_at_idx] ON [dbo].[queue_jobs]([status], [next_attempt_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [webhook_deliveries_tenant_id_received_at_idx] ON [dbo].[webhook_deliveries]([tenant_id], [received_at]);

-- Filtered unique indexes: SQL Server allows only one NULL in a plain UNIQUE constraint.
-- irn is NULL until stamped; dedupe_key is NULL once an error is resolved.
CREATE UNIQUE NONCLUSTERED INDEX [invoices_irn_key] ON [dbo].[invoices]([irn]) WHERE [irn] IS NOT NULL;

CREATE UNIQUE NONCLUSTERED INDEX [validation_errors_tenant_id_dedupe_key_key] ON [dbo].[validation_errors]([tenant_id], [dedupe_key]) WHERE [dedupe_key] IS NOT NULL;

-- AddForeignKey
ALTER TABLE [dbo].[erp_connections] ADD CONSTRAINT [erp_connections_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[customer_refs] ADD CONSTRAINT [customer_refs_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[item_refs] ADD CONSTRAINT [item_refs_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_connection_id_fkey] FOREIGN KEY ([connection_id]) REFERENCES [dbo].[erp_connections]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoice_line_items] ADD CONSTRAINT [invoice_line_items_invoice_id_fkey] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[invoices]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[validation_errors] ADD CONSTRAINT [validation_errors_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[audit_logs] ADD CONSTRAINT [audit_logs_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[queue_jobs] ADD CONSTRAINT [queue_jobs_tenant_id_fkey] FOREIGN KEY ([tenant_id]) REFERENCES [dbo].[tenants]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

