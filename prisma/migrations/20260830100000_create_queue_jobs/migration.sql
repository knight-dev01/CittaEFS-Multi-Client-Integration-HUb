-- QueueJob for BullMQ/DB fallback (was in schema but never migrated)
CREATE TABLE IF NOT EXISTS "queue_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  CONSTRAINT "queue_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "queue_jobs_tenant_id_idx" ON "queue_jobs"("tenant_id");
CREATE INDEX IF NOT EXISTS "queue_jobs_status_next_attempt_at_idx" ON "queue_jobs"("status", "next_attempt_at");
