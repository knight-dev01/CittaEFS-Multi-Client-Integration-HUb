-- Error digest email: per-tenant recipients + per-error "already emailed" marker.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "notification_email" TEXT;
ALTER TABLE "validation_errors" ADD COLUMN IF NOT EXISTS "notified_at" TIMESTAMP(3);

-- Errors that existed before this feature are treated as already notified, so the
-- first digest after deploy contains only new errors instead of the whole backlog.
UPDATE "validation_errors" SET "notified_at" = CURRENT_TIMESTAMP WHERE "notified_at" IS NULL;

CREATE INDEX IF NOT EXISTS "validation_errors_notified_at_status_idx" ON "validation_errors"("notified_at", "status");
