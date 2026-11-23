/**
 * Pure uptime aggregation over connectivity probes (no database access, so it
 * is unit tested directly). Used by src/services/connectivityService.ts.
 */

export interface ProbeRow {
  target: string;
  tenantErpId: string | null;
  label: string;
  ok: boolean;
  latencyMs: number;
  error: string | null;
  checkedAt: Date;
}

export interface UptimeBucket {
  start: string;
  probes: number;
  up: number;
}

export interface UptimeTarget {
  key: string;
  target: "ERP" | "CITTAEFS";
  tenantErpId: string | null;
  label: string;
  currentlyUp: boolean | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  uptimePct: number | null;
  uptimePct7d: number | null;
  avgLatencyMs: number | null;
  probes: number;
  buckets: UptimeBucket[];
}

function pct(up: number, total: number): number | null {
  return total > 0 ? Number(((up / total) * 100).toFixed(2)) : null;
}

/**
 * Pure aggregation so it can be unit tested: groups probes per target and
 * splits the window into `bucketCount` equal buckets, oldest first.
 */
export function summarizeUptime(
  rows: ProbeRow[],
  opts: { now: Date; windowHours: number; bucketCount: number },
): UptimeTarget[] {
  const { now, windowHours, bucketCount } = opts;
  const windowMs = windowHours * 3600 * 1000;
  const windowStart = now.getTime() - windowMs;
  const weekStart = now.getTime() - 7 * 24 * 3600 * 1000;
  const bucketMs = windowMs / bucketCount;

  const groups = new Map<string, ProbeRow[]>();
  for (const row of rows) {
    const key = row.target === "ERP" ? `ERP:${row.tenantErpId ?? row.label}` : "CITTAEFS";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const targets: UptimeTarget[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
    const latest = group[group.length - 1];
    const inWindow = group.filter(r => r.checkedAt.getTime() >= windowStart);
    const inWeek = group.filter(r => r.checkedAt.getTime() >= weekStart);

    const buckets: UptimeBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
      start: new Date(windowStart + i * bucketMs).toISOString(),
      probes: 0,
      up: 0,
    }));
    for (const r of inWindow) {
      const index = Math.min(bucketCount - 1, Math.floor((r.checkedAt.getTime() - windowStart) / bucketMs));
      buckets[index].probes += 1;
      if (r.ok) buckets[index].up += 1;
    }

    const okInWindow = inWindow.filter(r => r.ok);
    targets.push({
      key,
      target: latest.target === "ERP" ? "ERP" : "CITTAEFS",
      tenantErpId: latest.tenantErpId,
      label: latest.label,
      currentlyUp: latest.ok,
      lastCheckedAt: latest.checkedAt.toISOString(),
      lastError: latest.ok ? null : latest.error,
      uptimePct: pct(okInWindow.length, inWindow.length),
      uptimePct7d: pct(inWeek.filter(r => r.ok).length, inWeek.length),
      avgLatencyMs: okInWindow.length
        ? Math.round(okInWindow.reduce((sum, r) => sum + r.latencyMs, 0) / okInWindow.length)
        : null,
      probes: inWindow.length,
      buckets,
    });
  }

  // CittaEFS first, then ERPs by name.
  return targets.sort((a, b) =>
    a.target === b.target ? a.label.localeCompare(b.label) : a.target === "CITTAEFS" ? -1 : 1,
  );
}
