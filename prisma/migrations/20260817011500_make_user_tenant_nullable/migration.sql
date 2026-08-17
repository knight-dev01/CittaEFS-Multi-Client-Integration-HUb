-- Align the deployed database with prisma/schema.prisma.
-- Platform admin users are intentionally tenantless, so tenant_id must allow NULL.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_tenant_id_fkey";

ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL;

ALTER TABLE "users"
  ADD CONSTRAINT "users_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
