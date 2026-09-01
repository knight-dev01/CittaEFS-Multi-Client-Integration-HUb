-- Change default writeback target from HUB to BOTH so Hub invoices forward to CittaEFS by default
ALTER TABLE "tenants" ALTER COLUMN "citta_writeback_target" SET DEFAULT 'BOTH';
-- Backfill existing HUB tenants to BOTH (hub → CittaEFS forwarding)
UPDATE "tenants" SET "citta_writeback_target" = 'BOTH' WHERE "citta_writeback_target" = 'HUB';
