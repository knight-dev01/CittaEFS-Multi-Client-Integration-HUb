import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { CONNECTIVITY_EVENT } from '../lib/store';
import type { ConnectivityUptime, UptimeBucket, UptimeTarget } from '../types';
import { Card, CardHeader, CardBody } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { StatusBadge } from './ui/StatusBadge';
import { Wifi } from 'lucide-react';

const POLL_MS = 30_000;

function formatPct(value: number | null): string {
  return value === null ? '—' : `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}%`;
}

function formatAgo(iso: string | null, nowMs: number): string {
  if (!iso) return 'never';
  const sec = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

function bucketClass(bucket: UptimeBucket): string {
  if (bucket.probes === 0) return 'bg-line-strong';
  if (bucket.up === bucket.probes) return 'bg-emerald-600';
  if (bucket.up === 0) return 'bg-rose-600';
  return 'bg-amber-400';
}

function bucketTitle(bucket: UptimeBucket, windowHours: number): string {
  const start = new Date(bucket.start);
  const label = windowHours <= 24
    ? start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : start.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  if (bucket.probes === 0) return `${label}: no checks`;
  return `${label}: ${bucket.up}/${bucket.probes} checks up`;
}

function TargetRow({ target, windowHours, nowMs }: { target: UptimeTarget; windowHours: number; nowMs: number }) {
  const tone = target.currentlyUp === null ? 'neutral' : target.currentlyUp ? 'ok' : 'fail';
  return (
    <div className="rounded-lg border border-line bg-panel-muted px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge tone={tone}>{target.currentlyUp === null ? 'Unknown' : target.currentlyUp ? 'Up' : 'Down'}</StatusBadge>
          <span className="truncate text-sm font-medium text-ink">{target.label}</span>
          <span className="text-xs text-ink-faint">{target.target === 'CITTAEFS' ? 'Gateway' : 'Source ERP'}</span>
        </div>
        <dl className="flex gap-4 text-xs">
          <div><dt className="text-ink-faint">Uptime {windowHours <= 24 ? '24h' : '7d'}</dt><dd className="font-semibold text-ink">{formatPct(target.uptimePct)}</dd></div>
          <div><dt className="text-ink-faint">7d</dt><dd className="font-medium text-ink">{formatPct(target.uptimePct7d)}</dd></div>
          <div><dt className="text-ink-faint">Latency</dt><dd className="font-medium text-ink">{target.avgLatencyMs === null ? '—' : `${target.avgLatencyMs} ms`}</dd></div>
          <div><dt className="text-ink-faint">Checked</dt><dd className="font-medium text-ink">{formatAgo(target.lastCheckedAt, nowMs)}</dd></div>
        </dl>
      </div>
      <div className="mt-2.5 flex h-6 items-stretch gap-0.5" aria-label={`${target.label} uptime history`}>
        {target.buckets.map(bucket => (
          <div key={bucket.start} className={`flex-1 rounded-sm ${bucketClass(bucket)}`} title={bucketTitle(bucket, windowHours)} />
        ))}
      </div>
      {!target.currentlyUp && target.lastError && (
        <p className="mt-2 break-words text-xs text-rose-700">{target.lastError}</p>
      )}
    </div>
  );
}

export function ConnectivityUptimeCard({ tenantId }: { tenantId: string }) {
  const [hours, setHours] = useState<24 | 168>(24);
  const [data, setData] = useState<ConnectivityUptime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Ticks the "checked Xs ago" labels every second.
  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/metrics/uptime?tenantId=${encodeURIComponent(tenantId)}&hours=${hours}`);
      setData(await parseJsonResponse<ConnectivityUptime>(res));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load uptime');
    }
  }, [tenantId, hours]);

  // Live: reload when the server reports a finished probe round, and poll as a
  // safety net in case the event stream is disconnected.
  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    const onProbe = () => { load(); };
    window.addEventListener(CONNECTIVITY_EVENT, onProbe);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(CONNECTIVITY_EVENT, onProbe);
    };
  }, [load]);

  const intervalSec = data ? Math.round(data.probeIntervalMs / 1000) : 60;
  const cadence = intervalSec < 120 ? `${intervalSec}s` : `${Math.round(intervalSec / 60)} min`;
  const toggle = (
    <div className="inline-flex rounded-md border border-line bg-panel p-0.5 text-xs">
      {([24, 168] as const).map(h => (
        <button
          key={h}
          type="button"
          onClick={() => setHours(h)}
          className={`rounded px-2 py-1 font-medium ${hours === h ? 'bg-ink text-panel' : 'text-ink-soft hover:text-ink'}`}
        >
          {h === 24 ? '24h' : '7d'}
        </button>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Connectivity uptime"
        meta={(
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            Live · source ERPs and CittaEFS, checked every {cadence}
          </span>
        )}
        action={toggle}
      />
      {error && !data ? (
        <CardBody><p className="text-sm text-rose-700">{error}</p></CardBody>
      ) : !data ? (
        <CardBody><p className="py-4 text-center text-sm text-ink-soft">Loading uptime…</p></CardBody>
      ) : data.targets.length === 0 ? (
        <EmptyState
          icon={Wifi}
          title="No connectivity checks yet"
          description={`The first check runs within ${cadence} of a connected ERP. Use Test on the Connections tab to check now.`}
        />
      ) : (
        <CardBody className="space-y-3">
          {data.targets.map(target => (
            <TargetRow key={target.key} target={target} windowHours={data.windowHours} nowMs={nowMs} />
          ))}
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />All up</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Partial</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-600" />Down</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-line-strong" />No checks</span>
          </div>
        </CardBody>
      )}
    </Card>
  );
}
