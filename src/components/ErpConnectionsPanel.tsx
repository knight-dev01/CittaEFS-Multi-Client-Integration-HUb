import { useEffect, useMemo, useState } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { toastGlobal } from './ui/Toast';
import { Card, CardHeader, CardBody } from './ui/Card';
import { Button } from './ui/Button';
import { StatusBadge, statusTone } from './ui/StatusBadge';
import { Activity, RefreshCw, Save, History, AlertTriangle } from 'lucide-react';

interface ErpHealth {
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  latencyMs?: number;
  companyName?: string;
  authStatus?: 'AUTHENTICATED' | 'FAILED' | 'UNKNOWN';
  consecutiveFailures?: number;
}

interface MappingConfig {
  taxRates: Record<string, string>;
  products: Record<string, string>;
}

interface ErpConnection {
  id: string;
  platformType: string;
  displayName?: string | null;
  erpId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'NEEDS_REAUTH';
  availability?: 'live' | 'planned';
  label?: string;
  mappingConfig?: MappingConfig;
  health?: ErpHealth;
  lastSyncAt?: string | null;
}

interface ErpRun {
  id: string;
  jobName: string;
  status: string;
  attempts: number;
  maxRetries: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function formatWhen(value?: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function mapToText(map?: Record<string, string>): string {
  return Object.entries(map || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function textToMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export function ErpConnectionsPanel({ tenantId, onChanged }: { tenantId: string; onChanged?: () => void }) {
  const [connections, setConnections] = useState<ErpConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [taxDraft, setTaxDraft] = useState<Record<string, string>>({});
  const [productDraft, setProductDraft] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Record<string, ErpRun[]>>({});
  const [loadingRunsId, setLoadingRunsId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps`);
      const data = await parseJsonResponse(res);
      const list: ErpConnection[] = Array.isArray(data) ? data : [];
      setConnections(list);
      setTaxDraft((current) => {
        const next = { ...current };
        for (const connection of list) {
          if (next[connection.id] === undefined) {
            next[connection.id] = mapToText(connection.mappingConfig?.taxRates);
          }
        }
        return next;
      });
      setProductDraft((current) => {
        const next = { ...current };
        for (const connection of list) {
          if (next[connection.id] === undefined) {
            next[connection.id] = mapToText(connection.mappingConfig?.products);
          }
        }
        return next;
      });
    } catch (error: any) {
      toastGlobal('error', 'Could not load ERP connections', error?.message);
      setConnections([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const loadRuns = async (connectionId: string) => {
    setLoadingRunsId(connectionId);
    try {
      const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps/${connectionId}/runs`);
      const data = await parseJsonResponse(res);
      setRuns((current) => ({ ...current, [connectionId]: Array.isArray(data?.runs) ? data.runs : [] }));
    } catch (error: any) {
      toastGlobal('error', 'Could not load recent runs', error?.message);
    } finally {
      setLoadingRunsId(null);
    }
  };

  const handleToggle = (connection: ErpConnection) => {
    const next = openId === connection.id ? null : connection.id;
    setOpenId(next);
    if (next && !runs[connection.id]) loadRuns(connection.id);
  };

  const handleTest = async (connection: ErpConnection) => {
    setTestingId(connection.id);
    try {
      const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps/${connection.id}/test`, { method: 'POST' });
      const result = await parseJsonResponse(res);
      if (result?.success) {
        toastGlobal('success', `${connection.label || connection.platformType} health check passed`, result.message);
      } else {
        toastGlobal('error', `${connection.label || connection.platformType} health check failed`, result?.message);
      }
      await load();
      await loadRuns(connection.id);
      onChanged?.();
    } catch (error: any) {
      toastGlobal('error', 'Health check could not run', error?.message);
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveMapping = async (connection: ErpConnection) => {
    setSavingId(connection.id);
    try {
      const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps/${connection.id}/mapping`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace: true,
          taxRates: textToMap(taxDraft[connection.id] || ''),
          products: textToMap(productDraft[connection.id] || ''),
        }),
      });
      const updated = await parseJsonResponse(res);
      setConnections((current) => current.map((row) => (row.id === connection.id ? { ...row, ...updated } : row)));
      toastGlobal('success', 'Mapping saved', `${connection.label || connection.platformType} now has ${Object.keys(updated?.mappingConfig?.taxRates || {}).length} tax code(s) and ${Object.keys(updated?.mappingConfig?.products || {}).length} product code(s).`);
      onChanged?.();
    } catch (error: any) {
      toastGlobal('error', 'Mapping was not saved', error?.message);
    } finally {
      setSavingId(null);
    }
  };

  const liveConnections = useMemo(
    () => connections.filter((connection) => connection.availability !== 'planned'),
    [connections],
  );

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <p className="py-6 text-center text-sm text-ink-soft">Loading ERP connections…</p>
        </CardBody>
      </Card>
    );
  }

  if (liveConnections.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="ERP connection health"
        meta="Per-connection smoke test, mapping and recent queue runs. Queueing stays shared."
        action={
          <Button variant="ghost" size="sm" onClick={load} title="Reload connection health">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {liveConnections.map((connection) => {
          const health = connection.health || {};
          const isOpen = openId === connection.id;
          const connectionRuns = runs[connection.id] || [];
          return (
            <div key={connection.id} className="rounded-lg border border-line">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Activity className="h-4 w-4 shrink-0 text-ink-faint" />
                  <span className="truncate text-sm font-medium text-ink">
                    {connection.label || connection.displayName || connection.platformType}
                  </span>
                  <StatusBadge tone={statusTone(connection.status)}>{connection.status}</StatusBadge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(connection)}
                    disabled={testingId === connection.id}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${testingId === connection.id ? 'animate-spin' : ''}`} />
                    {testingId === connection.id ? 'Testing…' : 'Test now'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleToggle(connection)}>
                    {isOpen ? 'Hide' : 'Details'}
                  </Button>
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-2 border-t border-line px-4 py-3 text-xs sm:grid-cols-2">
                <Row label="Last checked">{formatWhen(health.lastCheckedAt)}</Row>
                <Row label="Latency">{health.latencyMs !== undefined ? `${health.latencyMs} ms` : '—'}</Row>
                <Row label="Company">{health.companyName || '—'}</Row>
                <Row label="Auth">{health.authStatus || 'UNKNOWN'}</Row>
              </dl>

              {health.lastError && (
                <div className="border-t border-line px-4 py-3">
                  <p className="flex items-start gap-2 text-xs text-rose-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{connection.status === 'NEEDS_REAUTH' ? 'Reconnect this ERP to restore syncing.' : 'The last probe failed; the connection is unchanged.'}</span>
                  </p>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs font-medium text-ink-soft">Technical detail</summary>
                    <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-md bg-panel-muted p-2 text-[11px] text-ink-soft">{health.lastError}</pre>
                  </details>
                </div>
              )}

              {isOpen && (
                <div className="space-y-4 border-t border-line px-4 py-4">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Mapping</h4>
                    <p className="mt-1 text-xs text-ink-faint">
                      One entry per line as <span className="font-mono">source=target</span>. Tax uses the VAT rate, product uses the hub SKU.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="block text-xs">
                        <span className="mb-1 block font-medium text-ink-soft">Tax rate → ERP tax code</span>
                        <textarea
                          value={taxDraft[connection.id] ?? ''}
                          onChange={(event) => setTaxDraft((current) => ({ ...current, [connection.id]: event.target.value }))}
                          rows={5}
                          spellCheck={false}
                          className="w-full rounded-lg border border-line-strong bg-panel px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="mb-1 block font-medium text-ink-soft">Hub SKU → ERP product code</span>
                        <textarea
                          value={productDraft[connection.id] ?? ''}
                          onChange={(event) => setProductDraft((current) => ({ ...current, [connection.id]: event.target.value }))}
                          rows={5}
                          spellCheck={false}
                          className="w-full rounded-lg border border-line-strong bg-panel px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" onClick={() => handleSaveMapping(connection)} disabled={savingId === connection.id}>
                        <Save className="h-3.5 w-3.5" />
                        {savingId === connection.id ? 'Saving…' : 'Save mapping'}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                        <History className="h-3.5 w-3.5" />
                        Recent gateway runs
                      </h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => loadRuns(connection.id)}
                        disabled={loadingRunsId === connection.id}
                      >
                        <RefreshCw className={`h-3 w-3 ${loadingRunsId === connection.id ? 'animate-spin' : ''}`} />
                        Reload
                      </Button>
                    </div>
                    {connectionRuns.length === 0 ? (
                      <p className="mt-2 text-xs text-ink-faint">No runs recorded for this connection yet.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-line bg-panel-muted text-ink-soft">
                            <tr>
                              <th className="px-3 py-2 font-medium">When</th>
                              <th className="px-3 py-2 font-medium">Job</th>
                              <th className="px-3 py-2 font-medium">Status</th>
                              <th className="px-3 py-2 font-medium">Attempts</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {connectionRuns.map((run) => (
                              <tr key={run.id}>
                                <td className="px-3 py-2 text-ink-soft">{formatWhen(run.createdAt)}</td>
                                <td className="px-3 py-2 font-mono text-ink">{run.jobName}</td>
                                <td className="px-3 py-2">
                                  <StatusBadge tone={statusTone(run.status)}>{run.status}</StatusBadge>
                                </td>
                                <td className="px-3 py-2 text-ink-soft">{run.attempts}/{run.maxRetries}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
