import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import type { SystemMetrics, MetricsTimeseriesPoint } from '../types';
import { PageHeader } from './ui/PageHeader';
import { Card, CardHeader, CardBody } from './ui/Card';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { Notice } from './ui/Notice';
import { StatusBadge } from './ui/StatusBadge';
import { Activity, Clock, RefreshCw } from 'lucide-react';

function formatLag(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return 'never synced';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

// Same date basis as the server (`toISOString().slice(0,10)`), so a bar lands on
// the day the API counted it rather than the day it is locally.
function utcDayKey(daysAgo: number): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return utc.toISOString().slice(0, 10);
}

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-faint">{note}</p>}
    </div>
  );
}

export function OverviewTab() {
  const { activeTenant, isBgRefreshing } = useHub() as any;
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithAuth(`/api/metrics?tenantId=${encodeURIComponent(activeTenant.id)}`);
      const data = await parseJsonResponse<SystemMetrics>(res);
      setMetrics(data);
    } catch (e: any) {
      setMetrics(null);
      setLoadError(e?.message || 'Could not load metrics');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const chartDays = useMemo<MetricsTimeseriesPoint[]>(() => {
    const byDate = new Map((metrics?.timeseries ?? []).map(point => [point.date, point]));
    return Array.from({ length: 30 }, (_, index) => {
      const date = utcDayKey(29 - index);
      return byDate.get(date) ?? { date, qbo: 0, odoo: 0, total: 0 };
    });
  }, [metrics?.timeseries]);

  const chartMax = useMemo(
    () => Math.max(1, ...chartDays.map(day => day.total)),
    [chartDays]
  );

  if (!activeTenant) {
    return <p className="py-16 text-center text-sm text-ink-soft">No workspace — connect an ERP to see metrics.</p>;
  }

  const busy = isLoading || isBgRefreshing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={<>Delivery health for <span className="font-medium text-ink">{activeTenant.name}</span>, measured from the invoice ledger.</>}
        actions={(
          <Button variant="secondary" onClick={loadMetrics} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      {loadError && (
        <Notice tone="fail" title="Metrics unavailable">{loadError}</Notice>
      )}

      {!metrics && isLoading && (
        <Card><CardBody><p className="py-8 text-center text-sm text-ink-soft">Loading metrics…</p></CardBody></Card>
      )}

      {metrics && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Invoices processed"
              value={metrics.totalInvoicesProcessed.toLocaleString()}
              note={`${metrics.activeTenantsCount} workspace${metrics.activeTenantsCount === 1 ? '' : 's'} in scope`}
            />
            <StatTile
              label="Stamp success rate"
              value={`${metrics.nrsStampSuccessRate}%`}
              note="APPROVED or SIGNED of all invoices"
            />
            <StatTile
              label="Average latency"
              value={metrics.averageLatencyMs ? `${(metrics.averageLatencyMs / 1000).toFixed(1)}s` : '—'}
              note="Last 20 completed queue jobs"
            />
            <StatTile
              label="Open validation errors"
              value={metrics.pendingValidationCount.toLocaleString()}
              note={metrics.pendingValidationCount > 0 ? 'Fix them on the Validation tab' : 'Nothing blocking'}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Approved stamps per day"
                meta="Last 30 days, UTC days"
                action={<StatusBadge tone="neutral">{metrics.cittaGatewayStatus}</StatusBadge>}
              />
              <CardBody>
                <div className="flex h-32 items-end gap-1">
                  {chartDays.map(day => {
                    const height = (day.total / chartMax) * 100;
                    return (
                      <div
                        key={day.date}
                        className="flex h-full flex-1 items-end"
                        title={`${day.date}: ${day.total} approved (${day.qbo} QBO, ${day.odoo} Odoo)`}
                      >
                        {day.total > 0 ? (
                          <div className="w-full rounded-sm bg-accent" style={{ height: `${Math.max(height, 4)}%` }} />
                        ) : (
                          <div className="h-px w-full bg-line-strong" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between text-xs text-ink-faint">
                  <span>{chartDays[0]?.date}</span>
                  <span>max {chartMax}/day</span>
                  <span>{chartDays[chartDays.length - 1]?.date}</span>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="By source ERP" meta="Within this workspace" />
              {(metrics.byErp ?? []).length === 0 ? (
                <EmptyState icon={Activity} title="No invoices yet" description="Counts appear once an ERP sync has produced invoices." />
              ) : (
                <CardBody className="space-y-3">
                  {(metrics.byErp ?? []).map(erp => (
                    <div key={erp.sourceErp} className="rounded-lg border border-line bg-panel-muted px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium uppercase tracking-wide text-ink">{erp.sourceErp}</span>
                        <span className="text-xs text-ink-soft">{erp.successRate}% ok</span>
                      </div>
                      <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                        <div><dt className="text-ink-faint">Total</dt><dd className="font-medium text-ink">{erp.total}</dd></div>
                        <div><dt className="text-ink-faint">OK</dt><dd className="font-medium text-ink">{erp.approved}</dd></div>
                        <div><dt className="text-ink-faint">Pending</dt><dd className="font-medium text-ink">{erp.pending}</dd></div>
                        <div><dt className="text-ink-faint">Failed</dt><dd className="font-medium text-ink">{erp.rejected}</dd></div>
                      </dl>
                    </div>
                  ))}
                </CardBody>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="ERP connections" meta="Last sync lag per connector" />
            {(metrics.erpHealth ?? []).length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No ERP connections in scope"
                description="Connect QuickBooks Online or Odoo on the Connections tab."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-panel-muted text-xs font-medium text-ink-soft">
                      <th className="py-3 pl-5 pr-4">Connector</th>
                      <th className="py-3 pr-4">ERP</th>
                      <th className="py-3 pr-4">Company</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-5">Last sync</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(metrics.erpHealth ?? []).map(conn => (
                      <tr key={conn.id} className="hover:bg-panel-muted">
                        <td className="py-3 pl-5 pr-4 font-medium text-ink">{conn.displayName || conn.erpId}</td>
                        <td className="py-3 pr-4 text-ink-soft">{conn.erpId}</td>
                        <td className="py-3 pr-4 font-mono text-xs text-ink-soft">{conn.companyId || '—'}</td>
                        <td className="py-3 pr-4">
                          <StatusBadge tone={conn.status === 'ACTIVE' ? 'ok' : conn.status === 'NEEDS_REAUTH' ? 'fail' : 'neutral'}>
                            {conn.status}
                          </StatusBadge>
                        </td>
                        <td className="py-3 pr-5 text-ink-soft">{formatLag(conn.lagSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {metrics.pendingValidationCount > 0 && (
            <Notice tone="warn" title={`${metrics.pendingValidationCount} invoice(s) are blocked on validation`}>
              Open the Validation tab to apply a code or TIN correction and re-queue them.
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
