-- AlterTable: Customer -- add spec-mandatory Country column and storage for the
-- CittaEFS-issued customer ID returned on registration (never persisted before).
ALTER TABLE "customers" ADD COLUMN "country" TEXT;
ALTER TABLE "customers" ADD COLUMN "citta_customer_id" TEXT;

-- AlterTable: Item -- add spec-mandatory ItemName and Unit Code (UN/ECE Rec 20) columns.
ALTER TABLE "items" ADD COLUMN "name" TEXT;
ALTER TABLE "items" ADD COLUMN "unit_code" TEXT NOT NULL DEFAULT 'EA';

-- Backfill existing items' name from description so nothing displays blank;
-- ItemDescription was previously doubling as the item's name.
UPDATE "items" SET "name" = "description" WHERE "name" IS NULL;
