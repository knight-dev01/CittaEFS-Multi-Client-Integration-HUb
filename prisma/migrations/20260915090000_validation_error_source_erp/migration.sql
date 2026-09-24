-- Bug fix: "resolve" on a validation error that fired before an Invoice was
-- ever created (bad HS code / TIN at ingestion time) only patched reference
-- data and never actually retried ingestion, silently leaving nothing to find.
-- sourceErp lets the resolve handler know which ingestion function to re-run
-- from the error's stored rawPayloadSample.

ALTER TABLE "validation_errors" ADD COLUMN "source_erp" TEXT;
