import { runAllErpHealthChecks, ErpHealthCronReport } from "../services/erpHealthService";

export const ERP_HEALTH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Fifteen-minute probe of every live ERP connection. The result updates
 * TenantErp.status and the health block inside TenantErp.config. Connections
 * without a CONNECTED Integration are skipped by the service, not marked
 * broken.
 */
export async function runErpHealthCron(): Promise<ErpHealthCronReport> {
  const report = await runAllErpHealthChecks();
  if (report.failed > 0 || report.needsReauth > 0) {
    console.warn(
      `[ERP health] checked ${report.checked}: ${report.healthy} healthy, ${report.failed} failed, ${report.needsReauth} need reauthorisation`,
    );
  }
  return report;
}
