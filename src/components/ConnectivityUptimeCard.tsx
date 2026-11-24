import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { CONNECTIVITY_EVENT } from '../lib/store';
import type { ConnectivityUptime, UptimeBucket, UptimeTarget } from '../types';
import { Card, CardHeader, CardBody } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { StatusBadge } from './ui/StatusBadge';
import { Wifi } from 'lucide-react';

const POLL_MS = 30_000;
type WindowHours = 1 | 24 | 168;
const WINDOWS: { hours: WindowHours; label: string }[] = [
  { hours: 1, label: '1h' },
  { hours: 24, label: '24h' },
  { hours: 168, label: '7d' },
];

const ACCENT = 'var(--color-accent)';
const FAIL = '#e11d48';

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

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

function formatTime(iso: string, windowHours: number): string {
  const d = new Date(iso);
  return windowHours > 24
    ? d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Rounds an axis maximum up to 1/2/5 × 10^n. */
function niceCeil(value: number): number {
  if (value <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Response-time line over the window, with failed checks shaded red. */
function LatencyChart({ buckets, windowHours, label }: { buckets: UptimeBucket[]; windowHours: number; label: string }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 132;
  const pad = { top: 8, right: 8, bottom: 20, left: 48 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const yMax = useMemo(
    () => niceCeil(Math.max(0, ...buckets.map(b => b.avgLatencyMs ?? 0)) * 1.1),
    [buckets],
  );
  const step = buckets.length ? plotW / buckets.length : 0;
  const xMid = (i: number) => pad.left + step * (i + 0.5);
  const y = (ms: number) => pad.top + plotH - (ms / yMax) * plotH;

  // Line segments break where a bucket has no successful checks.
  const segments = useMemo(() => {
    const out: string[] = [];
    let current = '';
    buckets.forEach((b, i) => {
      if (b.avgLatencyMs === null) {
        if (current) out.push(current);
        current = '';
        return;
      }
      current += `${current ? 'L' : 'M'}${xMid(i).toFixed(1)},${y(b.avgLatencyMs).toFixed(1)}`;
    });
    if (current) out.push(current);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, plotW, yMax]);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left) / (box.width / buckets.length));
    setHover(Math.max(0, Math.min(buckets.length - 1, i)));
  };

  const hovered = hover !== null ? buckets[hover] : null;
  const tooltipLeft = hover !== null ? Math.min(Math.max(xMid(hover) - 110, 0), Math.max(0, width - 220)) : 0;
  const yTicks = [0, yMax / 2, yMax];
  const xTicks = [0, Math.floor(buckets.length / 2), buckets.length - 1];

  return (
    <div ref={ref} className="relative w-full select-none">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${label} response time and failed checks`}>
          {yTicks.map(t => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-ink-faint)">
                {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}s` : `${Math.round(t)}ms`}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const failed = b.probes - b.up;
            if (!failed) return null;
            return (
              <g key={b.start}>
                <rect
                  x={pad.left + step * i}
                  y={pad.top}
                  width={Math.max(step, 1.5)}
                  height={plotH}
                  fill={FAIL}
                  opacity={b.up === 0 ? 0.22 : 0.1}
                />
                <rect x={pad.left + step * i} y={pad.top + plotH - 3} width={Math.max(step, 1.5)} height={3} fill={FAIL} />
              </g>
            );
          })}
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {xTicks.map((i, n) => buckets[i] && (
            <text
              key={i}
              x={n === 0 ? pad.left : n === 2 ? width - pad.right : xMid(i)}
              y={height - 5}
              textAnchor={n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}
              fontSize={10}
              fill="var(--color-ink-faint)"
            >
              {n === 2 ? 'now' : formatTime(buckets[i].start, windowHours)}
            </text>
          ))}
          {hovered && hover !== null && (
            <g pointerEvents="none">
              <line x1={xMid(hover)} x2={xMid(hover)} y1={pad.top} y2={pad.top + plotH} stroke="var(--color-ink-faint)" strokeWidth={1} strokeDasharray="3 3" />
              {hovered.avgLatencyMs !== null && (
                <circle cx={xMid(hover)} cy={y(hovered.avgLatencyMs)} r={4} fill={ACCENT} stroke="var(--color-panel)" strokeWidth={2} />
              )}
            </g>
          )}
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-[220px] rounded-md border border-line bg-panel px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltipLeft }}
        >
          <p className="font-medium text-ink">
            {formatTime(hovered.start, windowHours)} – {formatTime(hovered.end, windowHours)}
          </p>
          {hovered.probes === 0 ? (
            <p className="mt-1 text-ink-soft">No checks in this period</p>
          ) : (
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-ink-faint">Checks</dt>
              <dd className="text-right text-ink">{hovered.up} of {hovered.probes} passed</dd>
              <dt className="text-ink-faint">Avg response</dt>
              <dd className="text-right text-ink">{formatMs(hovered.avgLatencyMs)}</dd>
              <dt className="text-ink-faint">Slowest</dt>
              <dd className="text-right text-ink">{formatMs(hovered.maxLatencyMs)}</dd>
            </dl>
          )}
          {hovered.error && <p className="mt-1.5 break-words text-rose-700">{hovered.error}</p>}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'fail' }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={`text-lg font-semibold tracking-tight ${tone === 'fail' ? 'text-rose-700' : 'text-ink'}`}>{value}</dd>
      {note && <dd className="truncate text-xs text-ink-faint">{note}</dd>}
    </div>
  );
}

function TargetPanel({ target, windowHours, windowLabel, nowMs }: {
  target: UptimeTarget;
  windowHours: number;
  windowLabel: string;
  nowMs: number;
}) {
  const tone = target.currentlyUp === null ? 'neutral' : target.currentlyUp ? 'ok' : 'fail';
  const ongoing = target.incidents.find(i => i.end === null);

  return (
    <section className="rounded-lg border border-line bg-panel px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge tone={tone}>{target.currentlyUp === null ? 'Unknown' : target.currentlyUp ? 'Up' : 'Down'}</StatusBadge>
          <span className="truncate text-sm font-semibold text-ink">{target.label}</span>
          <span className="text-xs text-ink-faint">{target.target === 'CITTAEFS' ? 'Stamping gateway' : 'Source ERP'}</span>
        </div>
        <span className="text-xs text-ink-soft">
          Last check {formatAgo(target.lastCheckedAt, nowMs)}
          {target.lastLatencyMs !== null && <> · {formatMs(target.lastLatencyMs)}</>}
        </span>
      </div>

      {ongoing && (
        <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
          Down for {formatDuration(ongoing.durationMs)} ({ongoing.failedChecks} failed check{ongoing.failedChecks === 1 ? '' : 's'}).
          {ongoing.error && <span className="mt-0.5 block break-words">{ongoing.error}</span>}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label={`Uptime (${windowLabel})`}
          value={formatPct(target.uptimePct)}
          note={`${target.probes - target.failedProbes} of ${target.probes} checks passed`}
        />
        <Metric label="Uptime (7d)" value={formatPct(target.uptimePct7d)} />
        <Metric
          label={`Downtime (${windowLabel})`}
          value={target.downtimeMs ? formatDuration(target.downtimeMs) : 'None'}
          note={`${target.incidents.length} outage${target.incidents.length === 1 ? '' : 's'}`}
          tone={target.downtimeMs ? 'fail' : undefined}
        />
        <Metric label="Failed checks" value={target.failedProbes.toLocaleString()} tone={target.failedProbes ? 'fail' : undefined} />
        <Metric label="Avg response" value={formatMs(target.avgLatencyMs)} note="Successful checks" />
        <Metric label="p95 response" value={formatMs(target.p95LatencyMs)} note="95% were faster" />
      </dl>

      <div className="mt-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
          <span className="font-medium text-ink">Response time</span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: ACCENT }} />Avg response</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: FAIL, opacity: 0.4 }} />Failed checks</span>
          </span>
        </div>
        <LatencyChart buckets={target.buckets} windowHours={windowHours} label={target.label} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <details className="rounded-md border border-line bg-panel-muted px-3 py-2 text-xs" open={target.incidents.length > 0}>
          <summary className="cursor-pointer font-medium text-ink">
            Outages ({target.incidents.length})
          </summary>
          {target.incidents.length === 0 ? (
            <p className="mt-2 text-ink-soft">No outages in the last {windowLabel}.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {target.incidents.map(incident => (
                <li key={incident.start} className="border-t border-line pt-2 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ink">
                      {new Date(incident.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{formatDuration(incident.durationMs)}
                    </span>
                    {incident.end === null
                      ? <StatusBadge tone="fail">Ongoing</StatusBadge>
                      : <span className="text-ink-faint">Recovered {formatTime(incident.end, 1)}</span>}
                  </div>
                  <p className="text-ink-faint">{incident.failedChecks} failed check{incident.failedChecks === 1 ? '' : 's'}</p>
                  {incident.error && <p className="break-words text-rose-700">{incident.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </details>

        <details className="rounded-md border border-line bg-panel-muted px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-ink">Recent checks ({target.recentChecks.length})</summary>
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-left text-ink-faint">
                <th className="pb-1 font-normal">Time</th>
                <th className="pb-1 font-normal">Result</th>
                <th className="pb-1 text-right font-normal">Response</th>
              </tr>
            </thead>
            <tbody>
              {target.recentChecks.map(check => (
                <tr key={check.checkedAt} className="border-t border-line align-top">
                  <td className="py-1 pr-2 text-ink">{new Date(check.checkedAt).toLocaleTimeString()}</td>
                  <td className="py-1 pr-2">
                    {check.ok
                      ? <span className="text-emerald-700">Passed</span>
                      : <span className="break-words text-rose-700">Failed{check.error ? `: ${check.error}` : ''}</span>}
                  </td>
                  <td className="py-1 text-right text-ink">{check.ok ? formatMs(check.latencyMs) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

export function ConnectivityUptimeCard({ tenantId }: { tenantId: string }) {
  const [hours, setHours] = useState<WindowHours>(24);
  const [data, setData] = useState<ConnectivityUptime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Ticks the "last check Xs ago" labels every second.
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

  // Live: reload when the server reports a finished probe round, and poll in
  // case the event stream is disconnected.
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
  const windowLabel = WINDOWS.find(w => w.hours === hours)?.label ?? '24h';
  const toggle = (
    <div className="inline-flex rounded-md border border-line bg-panel p-0.5 text-xs">
      {WINDOWS.map(w => (
        <button
          key={w.hours}
          type="button"
          onClick={() => setHours(w.hours)}
          className={`rounded px-2 py-1 font-medium ${hours === w.hours ? 'bg-ink text-panel' : 'text-ink-soft hover:text-ink'}`}
        >
          {w.label}
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
            Live · each ERP and CittaEFS checked every {cadence}
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
            <TargetPanel key={target.key} target={target} windowHours={data.windowHours} windowLabel={windowLabel} nowMs={nowMs} />
          ))}
        </CardBody>
      )}
    </Card>
  );
}
