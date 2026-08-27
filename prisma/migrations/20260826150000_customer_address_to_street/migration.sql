-- The Customer template spec calls this column "StreetName", not a generic
-- freeform address. Rename in place -- existing data already held street-line
-- content, so no backfill needed.
ALTER TABLE "customers" RENAME COLUMN "address" TO "street";
