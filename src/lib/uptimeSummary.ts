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
  end: string;
  probes: number;
  up: number;
  /** Mean response time of the successful checks in the bucket. */
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  /** Most recent failure message in the bucket. */
  error: string | null;
}

export interface UptimeIncident {
  start: string;
  /** First successful check after the outage; null while still down. */
  end: string | null;
  durationMs: number;
  failedChecks: number;
  error: string | null;
}

export interface UptimeCheck {
  checkedAt: string;
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

export interface UptimeTarget {
  key: string;
  target: "ERP" | "CITTAEFS";
  tenantErpId: string | null;
  label: string;
  currentlyUp: boolean | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  uptimePct: number | null;
  uptimePct7d: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  probes: number;
  failedProbes: number;
  /** Total outage time inside the window. */
  downtimeMs: number;
  buckets: UptimeBucket[];
  /** Outages in the window, newest first (at most 10). */
  incidents: UptimeIncident[];
  /** Latest checks, newest first (at most 20). */
  recentChecks: UptimeCheck[];
}

function pct(up: number, total: number): number | null {
  return total > 0 ? Number(((up / total) * 100).toFixed(2)) : null;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** Runs of consecutive failed checks, oldest first. */
function findIncidents(rows: ProbeRow[], now: Date): UptimeIncident[] {
  const incidents: UptimeIncident[] = [];
  let open: { start: Date; failed: number; error: string | null } | null = null;
  for (const row of rows) {
    if (!row.ok) {
      if (!open) open = { start: row.checkedAt, failed: 0, error: null };
      open.failed += 1;
      open.error = row.error ?? open.error;
    } else if (open) {
      incidents.push({
        start: open.start.toISOString(),
        end: row.checkedAt.toISOString(),
        durationMs: row.checkedAt.getTime() - open.start.getTime(),
        failedChecks: open.failed,
        error: open.error,
      });
      open = null;
    }
  }
  if (open) {
    incidents.push({
      start: open.start.toISOString(),
      end: null,
      durationMs: Math.max(0, now.getTime() - open.start.getTime()),
      failedChecks: open.failed,
      error: open.error,
    });
  }
  return incidents;
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

    const perBucket: ProbeRow[][] = Array.from({ length: bucketCount }, () => []);
    for (const r of inWindow) {
      const index = Math.min(bucketCount - 1, Math.floor((r.checkedAt.getTime() - windowStart) / bucketMs));
      perBucket[index].push(r);
    }
    const buckets: UptimeBucket[] = perBucket.map((items, i) => {
      const ok = items.filter(r => r.ok);
      const failed = items.filter(r => !r.ok);
      return {
        start: new Date(windowStart + i * bucketMs).toISOString(),
        end: new Date(windowStart + (i + 1) * bucketMs).toISOString(),
        probes: items.length,
        up: ok.length,
        avgLatencyMs: ok.length ? Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length) : null,
        maxLatencyMs: ok.length ? Math.max(...ok.map(r => r.latencyMs)) : null,
        error: failed.length ? failed[failed.length - 1].error : null,
      };
    });

    const okInWindow = inWindow.filter(r => r.ok);
    const incidents = findIncidents(inWindow, now);
    targets.push({
      key,
      target: latest.target === "ERP" ? "ERP" : "CITTAEFS",
      tenantErpId: latest.tenantErpId,
      label: latest.label,
      currentlyUp: latest.ok,
      lastCheckedAt: latest.checkedAt.toISOString(),
      lastLatencyMs: latest.ok ? latest.latencyMs : null,
      lastError: latest.ok ? null : latest.error,
      uptimePct: pct(okInWindow.length, inWindow.length),
      uptimePct7d: pct(inWeek.filter(r => r.ok).length, inWeek.length),
      avgLatencyMs: okInWindow.length
        ? Math.round(okInWindow.reduce((sum, r) => sum + r.latencyMs, 0) / okInWindow.length)
        : null,
      p95LatencyMs: percentile(okInWindow.map(r => r.latencyMs), 95),
      probes: inWindow.length,
      failedProbes: inWindow.length - okInWindow.length,
      downtimeMs: incidents.reduce((sum, i) => sum + i.durationMs, 0),
      buckets,
      incidents: incidents.reverse().slice(0, 10),
      recentChecks: group.slice(-20).reverse().map(r => ({
        checkedAt: r.checkedAt.toISOString(),
        ok: r.ok,
        latencyMs: r.latencyMs,
        error: r.error,
      })),
    });
  }

  // CittaEFS first, then ERPs by name.
  return targets.sort((a, b) =>
    a.target === b.target ? a.label.localeCompare(b.label) : a.target === "CITTAEFS" ? -1 : 1,
  );
}

/** Window length -> chart resolution: 1h by minute, 24h by 15 min, 7d by hour. */
export function bucketCountFor(windowHours: number): number {
  if (windowHours <= 1) return 60;
  if (windowHours <= 24) return 96;
  return 168;
}
