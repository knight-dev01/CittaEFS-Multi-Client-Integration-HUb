import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { useHub } from '../lib/store';
import { toastGlobal } from './ui/Toast';
import {
  RefreshCw,
  Layers,
  Zap,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { StatusBadge } from './ui/StatusBadge';
import { PageHeader } from './ui/PageHeader';
import { Button } from './ui/Button';
import { Card, CardHeader, CardBody } from './ui/Card';
import { Notice } from './ui/Notice';
import { ErpConnectionsPanel } from './ErpConnectionsPanel';
import { PLANNED_ERPS } from '../config/erpRegistry';

function Row({ label, children, mono = false, tone }: { label: string; children: ReactNode; mono?: boolean; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className={`min-w-0 truncate text-right font-medium ${tone || 'text-ink'} ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}

interface ConnectorStatus {
  qbo: { connected: boolean; status: string; companyId: string | null; lastSyncAt: string | null; environment?: 'sandbox' | 'production' };
  odoo: { connected: boolean; status: string; database: string | null; lastSyncAt: string | null };
  cittaGateway: { totalStamped: number; totalPending: number; totalRejected: number };
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

export function ConnectionsTab({ onResumeConnect }: { onResumeConnect?: () => void } = {}) {
  const { activeTenant } = useHub();

  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [testingQbo, setTestingQbo] = useState(false);
  const [syncingQbo, setSyncingQbo] = useState(false);
  const [testingOdoo, setTestingOdoo] = useState(false);
  const [syncingOdoo, setSyncingOdoo] = useState(false);
  const [togglingQboEnv, setTogglingQboEnv] = useState(false);

  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const qboRedirectStatus = queryParams.get('qbo');
  const qboRedirectRealmId = queryParams.get('realmId');
  const qboRedirectError = queryParams.get('error') || queryParams.get('message');
  const isQboDisconnectedNotice = queryParams.get('qbo') === 'disconnected';
  const isQboConnectNotice = queryParams.get('connect') === 'qbo' || (typeof window !== 'undefined' && window.location.pathname === '/connect-quickbooks');

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await fetchWithAuth(`/api/connectors/status?tenantId=${activeTenant.id}`);
      const data = await parseJsonResponse(res);
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  useEffect(() => {
    if (qboRedirectStatus === 'success' || qboRedirectStatus === 'error') {
      loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qboRedirectStatus]);

  const handleSyncQbo = async () => {
    setSyncingQbo(true);
    try {
      const res = await fetchWithAuth('/api/integrations/qbo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setSyncingQbo(false);
      if (data.success) {
        toastGlobal('success', 'QuickBooks sync complete', `Found ${data.totalFound}, new ${data.newSynced}, already synced ${data.alreadySynced}`);
      } else {
        toastGlobal('error', 'Sync failed', data.error || 'Unknown error');
      }
      await loadStatus();
    } catch (err: any) {
      setSyncingQbo(false);
      const isReauth = err.message?.toLowerCase().includes('reauthorization');
      if (isReauth && confirm(`QuickBooks needs reauthorization:\n${err.message}\n\nReconnect now?`)) {
        window.location.href = `/api/integrations/qbo/connect?tenantId=${activeTenant.id}`;
        return;
      }
      toastGlobal('error', 'Sync error', err.message);
      await loadStatus();
    }
  };

  const handleTestQbo = async () => {
    setTestingQbo(true);
    try {
      const res = await fetchWithAuth('/api/connectors/qbo/test-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setTestingQbo(false);
      if (data.success) {
        toastGlobal('success', 'Live QuickBooks test passed', `${data.companyInfo?.CompanyName}, ${data.companyInfo?.Country}, ${data.latencyMs}ms`);
      } else {
        toastGlobal('error', 'Connection test failed', data.error || 'Unknown error');
      }
      await loadStatus();
    } catch (err: any) {
      setTestingQbo(false);
      toastGlobal('error', 'API error testing connector', err.message);
    }
  };

  const handleToggleQboEnvironment = async () => {
    const current = status?.qbo.environment || 'sandbox';
    const target = current === 'sandbox' ? 'production' : 'sandbox';
    const connected = !!status?.qbo.connected;
    const confirmMsg = connected
      ? `Switch QuickBooks from ${current.toUpperCase()} to ${target.toUpperCase()}?\n\nSandbox and production use separate Intuit credentials — your current connection will need to be reauthorized.`
      : `Switch QuickBooks to ${target.toUpperCase()} before connecting?`;
    if (!confirm(confirmMsg)) return;
    setTogglingQboEnv(true);
    try {
      const res = await fetchWithAuth('/api/integrations/qbo/environment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id, environment: target })
      });
      const data = await parseJsonResponse(res);
      if (data.success) {
        toastGlobal('success', `QuickBooks environment set to ${target.toUpperCase()}`, data.reauthRequired ? 'Existing connection needs reauthorization — use Connect QuickBooks Online below.' : '');
      } else {
        toastGlobal('error', 'Failed to switch environment', data.error || 'Unknown error');
      }
      await loadStatus();
    } catch (err: any) {
      toastGlobal('error', 'API error switching environment', err.message);
    } finally {
      setTogglingQboEnv(false);
    }
  };

  const handleSyncOdoo = async () => {
    setSyncingOdoo(true);
    try {
      const res = await fetchWithAuth('/api/integrations/odoo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setSyncingOdoo(false);
      if (data.success) {
        toastGlobal('success', 'Odoo sync complete', `Found ${data.totalFound}, new ${data.newSynced}, already synced ${data.alreadySynced}`);
      } else {
        toastGlobal('error', 'Sync failed', data.error || 'Unknown error');
      }
      await loadStatus();
    } catch (err: any) {
      setSyncingOdoo(false);
      toastGlobal('error', 'Sync error', err.message);
      await loadStatus();
    }
  };

  const handleTestOdoo = async () => {
    setTestingOdoo(true);
    try {
      const res = await fetchWithAuth('/api/connectors/odoo/test-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setTestingOdoo(false);
      if (data.success) {
        toastGlobal('success', 'Live Odoo test passed', `${data.companyInfo?.CompanyName}, ${data.companyInfo?.Currency}, ${data.latencyMs}ms`);
      } else {
        toastGlobal('error', 'Connection test failed', data.error || 'Unknown error');
      }
      await loadStatus();
    } catch (err: any) {
      setTestingOdoo(false);
      toastGlobal('error', 'API error testing connector', err.message);
    }
  };

  return (
    <div className="space-y-6">

      <PageHeader
        title="Connections"
        subtitle={<>ERP connections and CittaEFS gateway status for <span className="font-medium text-ink">{activeTenant.name}</span>.</>}
      />

      {/* QuickBooks OAuth Callback Result */}
      {qboRedirectStatus === 'success' && (
        <Notice
          tone="ok"
          title="QuickBooks Online connected"
          action={
            <Button size="sm" onClick={handleSyncQbo} disabled={syncingQbo}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncingQbo ? 'animate-spin' : ''}`} />
              {syncingQbo ? 'Syncing…' : 'Sync historical data'}
            </Button>
          }
        >
          Authorised for <strong className="font-medium text-ink">{activeTenant.name}</strong>.
          {qboRedirectRealmId && <> Realm ID <span className="font-mono">{qboRedirectRealmId}</span>.</>}
        </Notice>
      )}

      {qboRedirectStatus === 'error' && (
        <Notice
          tone="fail"
          title="QuickBooks authorisation failed"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.location.href = `/api/integrations/qbo/connect?tenantId=${encodeURIComponent(activeTenant.id)}`;
              }}
            >
              Try again
            </Button>
          }
        >
          {qboRedirectError || 'QuickBooks did not complete authorisation. Please try again.'}
        </Notice>
      )}

      {isQboDisconnectedNotice && (
        <Notice tone="warn" title="QuickBooks disconnected">
          The Intuit app session was disconnected. Reconnect QuickBooks Online below to restore CDC webhooks and IRN writebacks.
        </Notice>
      )}

      {isQboConnectNotice && (
        <Notice
          tone="info"
          title="Intuit authorisation request"
          action={<Button size="sm" onClick={() => onResumeConnect?.()}>Authorise QuickBooks</Button>}
        >
          You arrived from the QuickBooks App Store listing. Complete the OAuth 2.0 grant to finish connecting.
        </Notice>
      )}

      {isLoadingStatus ? (
        <p className="py-12 text-center text-sm text-ink-soft">Loading connector status…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">

          {/* QuickBooks Online — real Integration status */}
          <Card className="flex flex-col">
            <CardHeader
              title="QuickBooks Online"
              action={<StatusBadge tone={status?.qbo.connected ? 'ok' : 'pending'}>{status?.qbo.status || 'NOT_CONNECTED'}</StatusBadge>}
            />
            <CardBody className="flex-1">
              <dl className="space-y-2 text-xs">
                <Row label="Realm / company ID" mono>{status?.qbo.companyId || 'N/A'}</Row>
                <Row label="Last sync">{formatWhen(status?.qbo.lastSyncAt ?? null)}</Row>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-soft">Environment</dt>
                  <dd>
                    <button
                      onClick={handleToggleQboEnvironment}
                      disabled={togglingQboEnv}
                      title="Sandbox and production use separate Intuit credentials — switching an already-connected ERP needs reauthorisation"
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        (status?.qbo.environment || 'sandbox') === 'production'
                          ? 'border-accent-line bg-accent-soft text-accent-strong'
                          : 'border-line bg-panel-muted text-ink-soft'
                      }`}
                    >
                      {(status?.qbo.environment || 'sandbox') === 'production' ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                      {togglingQboEnv ? 'Switching…' : (status?.qbo.environment || 'sandbox')}
                    </button>
                  </dd>
                </div>
              </dl>
            </CardBody>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              {status?.qbo.connected ? (
                <>
                  <Button size="sm" variant="secondary" onClick={handleSyncQbo} disabled={syncingQbo}>
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingQbo ? 'animate-spin' : ''}`} />
                    {syncingQbo ? 'Syncing…' : 'Sync now'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleTestQbo} disabled={testingQbo}>
                    <RefreshCw className={`h-3.5 w-3.5 ${testingQbo ? 'animate-spin' : ''}`} />
                    {testingQbo ? 'Testing…' : 'Test live'}
                  </Button>
                </>
              ) : (
                <Button size="sm" className="w-full" onClick={() => onResumeConnect?.()}>
                  <Zap className="h-3.5 w-3.5" />
                  Connect QuickBooks Online
                </Button>
              )}
            </div>
          </Card>

          {/* Odoo ERP — real Integration status */}
          <Card className="flex flex-col">
            <CardHeader
              title="Odoo ERP"
              action={<StatusBadge tone={status?.odoo.connected ? 'ok' : 'pending'}>{status?.odoo.status || 'NOT_CONNECTED'}</StatusBadge>}
            />
            <CardBody className="flex-1">
              <dl className="space-y-2 text-xs">
                <Row label="Auth scheme">JSON-RPC API key</Row>
                <Row label="Database" mono>{status?.odoo.database || 'N/A'}</Row>
                <Row label="Last sync">{formatWhen(status?.odoo.lastSyncAt ?? null)}</Row>
              </dl>
            </CardBody>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              {status?.odoo.connected ? (
                <>
                  <Button size="sm" variant="secondary" onClick={handleSyncOdoo} disabled={syncingOdoo}>
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingOdoo ? 'animate-spin' : ''}`} />
                    {syncingOdoo ? 'Syncing…' : 'Sync now'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleTestOdoo} disabled={testingOdoo}>
                    <RefreshCw className={`h-3.5 w-3.5 ${testingOdoo ? 'animate-spin' : ''}`} />
                    {testingOdoo ? 'Testing…' : 'Test live'}
                  </Button>
                </>
              ) : (
                <Button size="sm" className="w-full" onClick={() => onResumeConnect?.()}>
                  <Layers className="h-3.5 w-3.5" />
                  Connect Odoo ERP
                </Button>
              )}
            </div>
          </Card>

          {/* CittaEFS Gateway — real stamping outcomes from the signing queue */}
          <Card className="flex flex-col">
            <CardHeader title="CittaEFS Gateway" meta="NRS stamping outcomes from the signing queue" />
            <CardBody className="flex-1">
              <dl className="space-y-2 text-xs">
                <Row label="Endpoint" mono>
                  <span title={activeTenant.cittaGatewayUrl || 'https://ei-api.azurewebsites.net'}>
                    {activeTenant.cittaGatewayUrl || 'https://ei-api.azurewebsites.net'}
                  </span>
                </Row>
                <Row label="Auth">Bearer (shared key)</Row>
                <Row label="Stamped / approved" mono tone="text-accent">{status?.cittaGateway.totalStamped ?? 0}</Row>
                <Row label="Pending stamp" mono tone="text-amber-600">{status?.cittaGateway.totalPending ?? 0}</Row>
                <Row label="Rejected" mono tone="text-rose-600">{status?.cittaGateway.totalRejected ?? 0}</Row>
              </dl>
            </CardBody>
          </Card>

        </div>
      )}

      {!isLoadingStatus && <ErpConnectionsPanel tenantId={activeTenant.id} onChanged={loadStatus} />}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Planned connectors</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              Adapter contracts are defined for these ERPs. They are not integrated yet — no live traffic is sent or accepted.
            </p>
          </div>
          <StatusBadge tone="neutral">{PLANNED_ERPS.length} planned</StatusBadge>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PLANNED_ERPS.map((erp) => {
            const Icon = erp.icon;
            return (
              <Card key={erp.id} className="flex flex-col">
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-ink-faint" />
                      {erp.label}
                    </span>
                  }
                  action={<StatusBadge tone="neutral">Not yet integrated</StatusBadge>}
                />
                <CardBody className="flex-1 space-y-3">
                  <p className="text-xs text-ink-soft">{erp.description}</p>
                  <dl className="space-y-2 text-xs">
                    <Row label="Auth">{erp.authMethod || 'To be confirmed'}</Row>
                    <Row label="API">{erp.apiStyle || 'To be confirmed'}</Row>
                  </dl>
                </CardBody>
                <div className="border-t border-line px-5 py-3">
                  <p className="text-[11px] text-ink-faint">
                    Planned adapter — the contract is documented, the connector is not built.
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

    </div>
  );
}
