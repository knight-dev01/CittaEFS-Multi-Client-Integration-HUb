import { describe, it, expect } from 'vitest';
import { summarizeUptime, type ProbeRow } from '../../lib/uptimeSummary';

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
});
