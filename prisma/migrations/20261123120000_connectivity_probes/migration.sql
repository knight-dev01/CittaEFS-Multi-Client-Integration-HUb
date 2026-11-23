-- Connectivity probes for the Overview uptime card (source ERPs + CittaEFS).
CREATE TABLE IF NOT EXISTS "connectivity_probes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "tenant_erp_id" TEXT,
    "label" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "error" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connectivity_probes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "connectivity_probes_tenant_id_checked_at_idx" ON "connectivity_probes"("tenant_id", "checked_at");
CREATE INDEX IF NOT EXISTS "connectivity_probes_checked_at_idx" ON "connectivity_probes"("checked_at");
