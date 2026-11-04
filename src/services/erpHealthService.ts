/**
 * Shared ERP connection health check used by the Test button and the
 * 15-minute cron. A connection is only probed when its Integration row is
 * CONNECTED, so an ERP nobody has authorised yet is never reported as broken.
 */
import { prisma } from "../lib/prisma";
import { readHealth, withHealth } from "../lib/erpConnectionConfig";
import { fetchQboCompanyInfo } from "./qboService";
import { fetchOdooCompanyInfo } from "./odooService";

const LIVE_ERP_IDS = new Set(["qbo", "odoo"]);

const INTEGRATION_SOURCE: Record<string, string> = {
  qbo: "QUICKBOOKS_ONLINE",
  odoo: "ODOO",
};

export type ErpConnectionStatus = "ACTIVE" | "INACTIVE" | "NEEDS_REAUTH";

export interface ErpHealthCheckResult {
  success: boolean;
  connected: boolean;
  skipped?: boolean;
  platformLabel: string;
  status: ErpConnectionStatus | "UNKNOWN";
  latencyMs: number;
  companyName?: string;
  message: string;
  technicalDetail?: string;
  checkedAt: string;
}

function isAuthFailure(message: string): boolean {
  return /reauthor|unauthor|invalid_grant|invalid api key|authentication failed|access denied|token (?:is )?(?:expired|invalid)|\b401\b/i.test(
    message,
  );
}

async function hasConnectedIntegration(tenantId: string, erpId: string): Promise<boolean> {
  const sourceSystem = INTEGRATION_SOURCE[erpId];
  if (!sourceSystem) return false;
  const integration = await prisma.integration.findFirst({
    where: { tenantId, sourceSystem, status: "CONNECTED" },
    select: { id: true },
  });
  return !!integration;
}

export async function checkErpConnection(tenantErpId: string): Promise<ErpHealthCheckResult> {
  const checkedAt = new Date().toISOString();
  const row = await prisma.tenantErp.findUnique({ where: { id: tenantErpId } });
  if (!row) {
    return {
      success: false,
      connected: false,
      platformLabel: "ERP",
      status: "UNKNOWN",
      latencyMs: 0,
      message: "ERP connection not found.",
      checkedAt,
    };
  }

  const platformLabel = row.displayName || row.platformType || row.erpId;

  if (!LIVE_ERP_IDS.has(row.erpId)) {
    return {
      success: false,
      connected: false,
      skipped: true,
      platformLabel,
      status: row.status as ErpConnectionStatus,
      latencyMs: 0,
      message: `${platformLabel} has no live adapter yet, so there is nothing to probe.`,
      checkedAt,
    };
  }

  if (!(await hasConnectedIntegration(row.tenantId, row.erpId))) {
    return {
      success: false,
      connected: false,
      platformLabel,
      status: row.status as ErpConnectionStatus,
      latencyMs: 0,
      message: `${platformLabel} is not connected yet. Authorise it from Connections before testing.`,
      checkedAt,
    };
  }

  const startedAt = Date.now();
  try {
    let companyName: string | undefined;
    if (row.erpId === "qbo") {
      const info = await fetchQboCompanyInfo(row.tenantId);
      companyName = info?.CompanyName ? String(info.CompanyName) : undefined;
    } else {
      const info = await fetchOdooCompanyInfo(row.tenantId);
      companyName = info?.name ? String(info.name) : undefined;
    }

    const latencyMs = Date.now() - startedAt;
    const config = withHealth(row.config, {
      lastCheckedAt: checkedAt,
      lastSuccessAt: checkedAt,
      latencyMs,
      companyName,
      authStatus: "AUTHENTICATED",
      lastError: undefined,
      consecutiveFailures: 0,
    });
    const status: ErpConnectionStatus = row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    await prisma.tenantErp.update({
      where: { id: row.id },
      data: { config, status },
    });

    return {
      success: true,
      connected: true,
      platformLabel,
      status,
      latencyMs,
      companyName,
      message: companyName
        ? `Connected to ${companyName} in ${latencyMs} ms.`
        : `Connected to ${platformLabel} in ${latencyMs} ms.`,
      checkedAt,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startedAt;
    const technicalDetail = String(error?.message || error);
    const authFailed = isAuthFailure(technicalDetail);
    const prior = readHealth(row.config);
    const config = withHealth(row.config, {
      lastCheckedAt: checkedAt,
      latencyMs,
      authStatus: authFailed ? "FAILED" : "UNKNOWN",
      lastError: technicalDetail,
      consecutiveFailures: (prior.consecutiveFailures || 0) + 1,
    });
    const status: ErpConnectionStatus = authFailed
      ? "NEEDS_REAUTH"
      : (row.status as ErpConnectionStatus);
    await prisma.tenantErp.update({
      where: { id: row.id },
      data: { config, status },
    });

    return {
      success: false,
      connected: true,
      platformLabel,
      status,
      latencyMs,
      message: authFailed
        ? `${platformLabel} rejected the saved credentials. Reconnect it from Connections.`
        : `${platformLabel} did not respond correctly. The connection is unchanged and will be retried.`,
      technicalDetail,
      checkedAt,
    };
  }
}

export interface ErpHealthCronReport {
  checked: number;
  healthy: number;
  failed: number;
  needsReauth: number;
  skipped: number;
}

export async function runAllErpHealthChecks(): Promise<ErpHealthCronReport> {
  const report: ErpHealthCronReport = {
    checked: 0,
    healthy: 0,
    failed: 0,
    needsReauth: 0,
    skipped: 0,
  };

  const connections = await prisma.tenantErp.findMany({
    where: { erpId: { in: Array.from(LIVE_ERP_IDS) }, status: { not: "INACTIVE" } },
    select: { id: true },
  });

  for (const connection of connections) {
    try {
      const result = await checkErpConnection(connection.id);
      report.checked += 1;
      if (result.skipped) report.skipped += 1;
      else if (result.success) report.healthy += 1;
      else {
        report.failed += 1;
        if (result.status === "NEEDS_REAUTH") report.needsReauth += 1;
      }
    } catch (error: any) {
      report.checked += 1;
      report.failed += 1;
      console.warn(`[ERP health] ${connection.id} probe failed:`, error?.message || error);
    }
  }

  return report;
}
