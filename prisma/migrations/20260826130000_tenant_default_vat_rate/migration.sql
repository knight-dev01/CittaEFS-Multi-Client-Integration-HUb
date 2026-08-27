-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "default_vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 7.5;

-- AlterTable
ALTER TABLE "items" ALTER COLUMN "default_vat_rate" SET DEFAULT 7.5;
