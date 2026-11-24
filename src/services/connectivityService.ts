/**
 * Connectivity uptime for the Overview tab: every probe of a source ERP
 * connection or of the CittaEFS gateway is stored as a ConnectivityProbe row,
 * and uptime is the share of successful probes in a window.
 */
import { prisma } from "../lib/prisma";
import { bucketCountFor, summarizeUptime, type UptimeTarget } from "../lib/uptimeSummary";

export type { ProbeRow, UptimeBucket, UptimeTarget } from "../lib/uptimeSummary";

export const PROBE_RETENTION_DAYS = 30;

export interface ProbeInput {
  tenantId: string;
  target: "ERP" | "CITTAEFS";
  tenantErpId?: string | null;
  label: string;
  ok: boolean;
  latencyMs: number;
  error?: string | null;
  checkedAt?: Date;
}

export async function recordProbe(input: ProbeInput): Promise<void> {
  try {
    await prisma.connectivityProbe.create({
      data: {
        tenantId: input.tenantId,
        target: input.target,
        tenantErpId: input.tenantErpId ?? null,
        label: input.label,
        ok: input.ok,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        error: input.error ? String(input.error).slice(0, 500) : null,
        checkedAt: input.checkedAt ?? new Date(),
      },
    });
  } catch (error: any) {
    // Uptime history is observability only; never let it break a probe.
    console.warn("[Connectivity] could not record probe:", error?.message || error);
  }
}

export async function pruneOldProbes(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PROBE_RETENTION_DAYS * 24 * 3600 * 1000);
  const { count } = await prisma.connectivityProbe.deleteMany({ where: { checkedAt: { lt: cutoff } } });
  return count;
}

export async function getUptime(
  tenantId: string | undefined,
  windowHours: number,
  now = new Date(),
): Promise<UptimeTarget[]> {
  const since = new Date(now.getTime() - Math.max(windowHours, 7 * 24) * 3600 * 1000);
  const rows = await prisma.connectivityProbe.findMany({
    where: { ...(tenantId ? { tenantId } : {}), checkedAt: { gte: since } },
    select: { target: true, tenantErpId: true, label: true, ok: true, latencyMs: true, error: true, checkedAt: true },
    orderBy: { checkedAt: "asc" },
  });
  // Drop history for ERP connections that were removed or switched off.
  const liveErps = await prisma.tenantErp.findMany({
    where: { ...(tenantId ? { tenantId } : {}), status: { not: "INACTIVE" } },
    select: { id: true },
  });
  const liveIds = new Set(liveErps.map(e => e.id));
  const visible = rows.filter(r => r.target !== "ERP" || (r.tenantErpId && liveIds.has(r.tenantErpId)));
  return summarizeUptime(visible, { now, windowHours, bucketCount: bucketCountFor(windowHours) });
}
