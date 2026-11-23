-- HS / service-code suggestions for open MISSING_HS_CODE validation errors.
CREATE TABLE IF NOT EXISTS "code_suggestions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "validation_error_id" TEXT NOT NULL,
    "lines_json" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "accepted_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "code_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "code_suggestions_validation_error_id_key" ON "code_suggestions"("validation_error_id");
CREATE INDEX IF NOT EXISTS "code_suggestions_tenant_id_status_idx" ON "code_suggestions"("tenant_id", "status");
