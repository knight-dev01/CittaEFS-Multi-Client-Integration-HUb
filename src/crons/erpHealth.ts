import { runAllErpHealthChecks, ErpHealthCronReport } from "../services/erpHealthService";
import { cittaEfsClient } from "../services/cittaEfsClient";
import { recordProbe, pruneOldProbes } from "../services/connectivityService";
import { prisma } from "../lib/prisma";

/** Default 60 seconds (live uptime); override with ERP_HEALTH_INTERVAL_MS. */
export const ERP_HEALTH_INTERVAL_MS = Number(process.env.ERP_HEALTH_INTERVAL_MS || 60 * 1000);

export interface ConnectivityCronReport extends ErpHealthCronReport {
  cittaEfsChecked: number;
  cittaEfsDown: number;
}

/**
 * Connectivity probe of every live ERP connection and of the CittaEFS gateway.
 * ERP results update TenantErp.status and the health block inside
 * TenantErp.config; every result is also stored as a ConnectivityProbe row,
 * which the Overview uptime card reads. Connections without a CONNECTED
 * Integration are skipped by the service, not marked broken.
 */
export async function runErpHealthCron(): Promise<ConnectivityCronReport> {
  const report = await runAllErpHealthChecks();
  if (report.failed > 0 || report.needsReauth > 0) {
    console.warn(
      `[ERP health] checked ${report.checked}: ${report.healthy} healthy, ${report.failed} failed, ${report.needsReauth} need reauthorisation`,
    );
  }

  // CittaEFS: one probe per workspace that has at least one ERP connection.
  let cittaEfsChecked = 0;
  let cittaEfsDown = 0;
  const tenants = await prisma.tenant.findMany({
    where: { tenantErps: { some: { status: { not: "INACTIVE" } } } },
    select: { id: true },
  });
  for (const tenant of tenants) {
    const result = await cittaEfsClient.probeConnectivity(tenant.id);
    cittaEfsChecked += 1;
    if (!result.ok) cittaEfsDown += 1;
    await recordProbe({ tenantId: tenant.id, target: "CITTAEFS", label: "CittaEFS gateway", ...result });
  }
  if (cittaEfsDown > 0) console.warn(`[Connectivity] CittaEFS gateway unreachable for ${cittaEfsDown}/${cittaEfsChecked} workspace(s)`);

  try {
    await pruneOldProbes();
  } catch (error: any) {
    console.warn("[Connectivity] prune failed:", error?.message || error);
  }

  return { ...report, cittaEfsChecked, cittaEfsDown };
}
