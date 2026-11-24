import { describe, it, expect } from 'vitest';
import { bucketCountFor, summarizeUptime, type ProbeRow } from '../../lib/uptimeSummary';

const now = new Date('2026-11-23T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000);
const erp = (h: number, ok: boolean, latencyMs = 100): ProbeRow => ({
  target: 'ERP', tenantErpId: 'erp-1', label: 'QuickBooks', ok, latencyMs, error: ok ? null : 'timeout', checkedAt: hoursAgo(h),
});
const efs = (h: number, ok: boolean): ProbeRow => ({
  target: 'CITTAEFS', tenantErpId: null, label: 'CittaEFS gateway', ok, latencyMs: 200, error: ok ? null : 'HTTP 503', checkedAt: hoursAgo(h),
});

describe('summarizeUptime', () => {
  it('computes uptime, latency and current state per target', () => {
    const [gateway, qbo] = summarizeUptime(
      [erp(3, true, 100), erp(2, false, 900), erp(1, true, 300), efs(2, true), efs(0.5, false)],
      { now, windowHours: 24, bucketCount: 24 },
    );
    expect(gateway.target).toBe('CITTAEFS');
    expect(gateway.uptimePct).toBe(50);
    expect(gateway.currentlyUp).toBe(false);
    expect(gateway.lastError).toBe('HTTP 503');

    expect(qbo.label).toBe('QuickBooks');
    expect(qbo.uptimePct).toBe(66.67);
    expect(qbo.currentlyUp).toBe(true);
    expect(qbo.lastError).toBeNull();
    expect(qbo.avgLatencyMs).toBe(200); // successful probes only
  });

  it('puts probes in the right hourly bucket and ignores older ones for the window', () => {
    const [qbo] = summarizeUptime([erp(30, false), erp(0.2, true), erp(23.5, false)], { now, windowHours: 24, bucketCount: 24 });
    expect(qbo.probes).toBe(2);
    expect(qbo.buckets).toHaveLength(24);
    expect(qbo.buckets[23]).toMatchObject({ probes: 1, up: 1 });
    expect(qbo.buckets[0]).toMatchObject({ probes: 1, up: 0 });
    expect(qbo.uptimePct7d).toBeCloseTo(33.33, 2);
  });

  it('returns null uptime when there are no checks in the window', () => {
    const [qbo] = summarizeUptime([erp(48, true)], { now, windowHours: 24, bucketCount: 24 });
    expect(qbo.uptimePct).toBeNull();
    expect(qbo.uptimePct7d).toBe(100);
  });

  it('reports outages, downtime, p95 and per-bucket latency', () => {
    const [qbo] = summarizeUptime(
      [erp(5, true, 100), erp(4, false), erp(3.5, false), erp(3, true, 300), erp(1, true, 500), erp(0.5, false)],
      { now, windowHours: 24, bucketCount: 24 },
    );
    expect(qbo.failedProbes).toBe(3);
    expect(qbo.incidents).toHaveLength(2);
    // Newest first: still down since 30 minutes ago.
    expect(qbo.incidents[0]).toMatchObject({ end: null, failedChecks: 1, durationMs: 30 * 60 * 1000 });
    expect(qbo.incidents[1]).toMatchObject({ failedChecks: 2, durationMs: 60 * 60 * 1000, error: 'timeout' });
    expect(qbo.downtimeMs).toBe(90 * 60 * 1000);
    expect(qbo.p95LatencyMs).toBe(500);
    expect(qbo.lastLatencyMs).toBeNull();
    expect(qbo.recentChecks[0].ok).toBe(false);
    expect(qbo.recentChecks).toHaveLength(6);
    expect(qbo.buckets[20]).toMatchObject({ probes: 2, up: 0, avgLatencyMs: null, error: 'timeout' });
    expect(qbo.buckets[21]).toMatchObject({ avgLatencyMs: 300, maxLatencyMs: 300 });
  });

  it('picks finer buckets for shorter windows', () => {
    expect(bucketCountFor(1)).toBe(60);
    expect(bucketCountFor(24)).toBe(96);
    expect(bucketCountFor(168)).toBe(168);
  });
});
