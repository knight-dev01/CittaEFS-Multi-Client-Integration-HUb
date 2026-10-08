-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "citta_mode" TEXT NOT NULL DEFAULT 'live';
ALTER TABLE "tenants" ADD COLUMN "citta_other_mode_config" TEXT;
