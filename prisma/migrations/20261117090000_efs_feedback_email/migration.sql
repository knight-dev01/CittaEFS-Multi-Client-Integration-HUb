-- EFS feedback email: per-invoice "approval already emailed" marker.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "feedback_notified_at" TIMESTAMP(3);

-- Invoices approved before this feature are treated as already notified, so the
-- first summary after deploy contains only new approvals instead of the whole history.
UPDATE "invoices" SET "feedback_notified_at" = CURRENT_TIMESTAMP
WHERE "feedback_notified_at" IS NULL AND "irn" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "invoices_feedback_notified_at_status_idx" ON "invoices"("feedback_notified_at", "status");
