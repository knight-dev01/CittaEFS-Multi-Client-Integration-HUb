import { useState, useEffect, useRef, FormEvent } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse, getApiBaseUrl } from '../lib/api';
import {
  ShieldCheck,
  Zap,
  Layers,
  Plug,
  RefreshCw,
  X
} from 'lucide-react';
import { Button } from './ui/Button';
import { Field, Input, Select } from './ui/Field';
import { Notice } from './ui/Notice';

interface OnboardClientModalProps {
  onClose: () => void;
  // An existing tenant whose ingestion channel was never authenticated
  // (e.g. they closed the OAuth popup, or clicked "Finish Later" during
  // onboarding) — shows its connect UI directly instead of a fresh onboarding.
  resumeTenant?: any;
}

type QboConnectState = 'idle' | 'connecting' | 'connected' | 'syncing' | 'synced' | 'error';
type OdooConnectState = 'idle' | 'connecting' | 'syncing' | 'synced' | 'error';

interface QboOAuthResult {
  type: 'qbo-oauth-result';
  success: boolean;
  tenantId?: string;
  realmId?: string;
  error?: string;
}

// Nigeria FIRS/NRS TIN format: one letter, 9 digits, one letter (e.g. P051123456Z)
const TIN_PATTERN = /^[A-Z]\d{9}[A-Z]$/;

function validateCompanyName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Client entity name is required.';
  if (trimmed.length < 2) return 'Must be at least 2 characters.';
  if (trimmed.length > 100) return 'Must be under 100 characters.';
  if (!/^[A-Za-z0-9 .,&'()\-]+$/.test(trimmed)) {
    return 'Only letters, numbers, spaces, and basic punctuation (. , & \' - ()) are allowed.';
  }
  return null;
}

function validateTin(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return 'Tax Identification Number is required.';
  if (!TIN_PATTERN.test(trimmed)) {
    return 'TIN must be one letter, 9 digits, one letter (e.g. P051123456Z).';
  }
  return null;
}

export function OnboardClientModal({ onClose, resumeTenant }: OnboardClientModalProps) {
  const { onboardTenant, updateTenant, refreshAll, addTenantErp } = useHub() as any;

  // Company fields — pre-filled when resuming
  const [companyName, setCompanyName] = useState(resumeTenant?.companyName || resumeTenant?.name || '');
  const [tin, setTin] = useState(resumeTenant?.tin || '');
  const [platformType, setPlatformType] = useState<'QuickBooks Online' | 'Odoo ERP'>(resumeTenant?.platformType === 'Excel & CSV Import' ? 'QuickBooks Online' : (resumeTenant?.platformType as any) || 'QuickBooks Online');
  const [marketTier, setMarketTier] = useState(resumeTenant?.marketTier || 'Enterprise');
  const [touched, setTouched] = useState({ companyName: false, tin: false });
  const [companySaved, setCompanySaved] = useState(!!resumeTenant);

  // Tenant record — created/updated on first connect attempt
  const [tenant, setTenant] = useState<any | null>(resumeTenant || null);

  // QBO connect state
  const [qboState, setQboState] = useState<QboConnectState>('idle');
  const [qboError, setQboError] = useState<string | null>(null);
  const [qboSyncStats, setQboSyncStats] = useState<{ totalFound: number; newSynced: number; alreadySynced: number } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qboSyncStartedRef = useRef(false);

  // Odoo connect state
  const [odooState, setOdooState] = useState<OdooConnectState>('idle');
  const [odooError, setOdooError] = useState<string | null>(null);
  const [odooSyncStats, setOdooSyncStats] = useState<{ totalFound: number; newSynced: number; alreadySynced: number } | null>(null);
  const [odooForm, setOdooForm] = useState({ odooUrl: '', odooDatabase: '', odooUsername: '', odooApiKey: '' });

  const isQbo = platformType === 'QuickBooks Online';

  // Ensures the tenant record exists (create or update) before connecting.
  // Returns the tenant, or null if validation failed (errors are set inline).
  const ensureTenant = async (): Promise<any | null> => {
    const nameErr = validateCompanyName(companyName);
    const tinErr = validateTin(tin);
    if (nameErr || tinErr) {
      setTouched({ companyName: true, tin: true });
      return null;
    }
    try {
      if (tenant) {
        const updated = await updateTenant(tenant.id, {
          companyName: companyName.trim(),
          tin: tin.trim().toUpperCase(),
          platformType,
          marketTier
        });
        setTenant(updated);
        setCompanySaved(true);
        return updated;
      }
      const newTenant = await onboardTenant({
        companyName: companyName.trim(),
        tin: tin.trim().toUpperCase(),
        platformType,
        marketTier
      });
      try { await addTenantErp(newTenant.id, platformType, platformType); } catch (e:any) { if (!String(e.message || '').toLowerCase().includes('already')) console.warn('addTenantErp:', e.message); }
      try { await refreshAll(); } catch {}
      setTenant(newTenant);
      setCompanySaved(true);
      return newTenant;
    } catch (err: any) {
      alert(`Failed to save client organization: ${err?.message || 'Please check details and try again.'}`);
      return null;
    }
  };

  const handleConnectOdoo = async (e: FormEvent) => {
    e.preventDefault();
    const t = tenant || await ensureTenant();
    if (!t) return;
    setOdooError(null);
    setOdooState('connecting');
    try {
      const res = await fetchWithAuth('/api/integrations/odoo/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: t.id, ...odooForm })
      });
      const data = await parseJsonResponse(res);
      if (!data.success) throw new Error(data.error || 'Failed to connect to Odoo.');

      setOdooState('syncing');
      const syncRes = await fetchWithAuth('/api/integrations/odoo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: t.id })
      });
      const syncData = await parseJsonResponse(syncRes);
      setOdooSyncStats({
        totalFound: syncData.totalFound ?? 0,
        newSynced: syncData.newSynced ?? 0,
        alreadySynced: syncData.alreadySynced ?? 0
      });
      setOdooState('synced');
      await refreshAll();
    } catch (err: any) {
      setOdooState('error');
      setOdooError(err.message || 'Failed to connect to Odoo.');
    }
  };

  const clearPopupPoll = () => {
    if (popupPollRef.current) {
      clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
  };

  const runInitialQboSync = async (tenantId: string) => {
    if (qboSyncStartedRef.current) return;
    qboSyncStartedRef.current = true;
    setQboState('syncing');
    try {
      const res = await fetchWithAuth('/api/integrations/qbo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId })
      });
      const data = await parseJsonResponse(res);
      setQboSyncStats({
        totalFound: data.totalFound ?? 0,
        newSynced: data.newSynced ?? 0,
        alreadySynced: data.alreadySynced ?? 0
      });
      setQboState('synced');
      await refreshAll();
    } catch (err: any) {
      setQboState('error');
      setQboError(err.message || 'Initial QuickBooks sync failed.');
      qboSyncStartedRef.current = false;
    }
  };

  const handleQboOAuthResult = (result: QboOAuthResult) => {
    if (!tenant || result.type !== 'qbo-oauth-result') return;
    if (result.tenantId && result.tenantId !== tenant.id) return;

    clearPopupPoll();

    if (result.success) {
      setQboError(null);
      setQboState('connected');
      runInitialQboSync(tenant.id);
    } else {
      setQboState('error');
      setQboError(result.error || 'QuickBooks authorization failed.');
    }
  };

  // Listen for the OAuth bridge page through message, BroadcastChannel, and storage.
  useEffect(() => {
    if (platformType !== 'QuickBooks Online' || !tenant) return;

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'qbo-oauth-result') return;
      handleQboOAuthResult(event.data);
    };

    const storageHandler = (event: StorageEvent) => {
      if (event.key !== 'citta_qbo_oauth_result' || !event.newValue) return;
      try {
        handleQboOAuthResult(JSON.parse(event.newValue));
      } catch {}
    };

    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('citta_qbo_oauth');
        channel.onmessage = (event) => handleQboOAuthResult(event.data);
      }
    } catch {}

    try {
      const savedResult = localStorage.getItem('citta_qbo_oauth_result');
      if (savedResult) handleQboOAuthResult(JSON.parse(savedResult));
    } catch {}

    window.addEventListener('message', handler);
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener('message', handler);
      window.removeEventListener('storage', storageHandler);
      channel?.close();
      clearPopupPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformType, tenant]);

  useEffect(() => {
    if (platformType !== 'QuickBooks Online' || !tenant || qboState !== 'connecting') return;

    const pollStatus = async () => {
      try {
        const res = await fetchWithAuth(`/api/integrations/qbo/status?tenantId=${encodeURIComponent(tenant.id)}`);
        const data = await parseJsonResponse(res);
        if (data.connected) {
          handleQboOAuthResult({
            type: 'qbo-oauth-result',
            success: true,
            tenantId: tenant.id,
            realmId: data.companyId || undefined
          });
        }
      } catch {}
    };

    pollStatus();
    const statusPoll = setInterval(pollStatus, 1500);
    return () => clearInterval(statusPoll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, qboState]);

  const handleConnectQuickBooks = async () => {
    const t = tenant || await ensureTenant();
    if (!t) return;
    setQboError(null);
    setQboSyncStats(null);
    qboSyncStartedRef.current = false;
    setQboState('connecting');

    const base = getApiBaseUrl();
    const url = `${base}/api/integrations/qbo/connect?tenantId=${encodeURIComponent(t.id)}`;
    const popup = window.open(url, 'qbo_oauth', 'width=600,height=750');
    popupRef.current = popup;

    if (!popup) {
      setQboState('error');
      setQboError('Popup was blocked by the browser. Please allow popups for this site and try again.');
      return;
    }

    clearPopupPoll();
    popupPollRef.current = setInterval(() => {
      if (popup.closed) {
        clearPopupPoll();
        setQboState(prev => (prev === 'connecting' ? 'idle' : prev));
      }
    }, 700);
  };

  const nameError = touched.companyName ? validateCompanyName(companyName) : null;
  const tinError = touched.tin ? validateTin(tin) : null;

  const pickPlatform = async (opt: 'QuickBooks Online' | 'Odoo ERP') => {
    if (opt === platformType) return;
    setPlatformType(opt);
    if (tenant?.id) {
      try {
        const updated = await updateTenant(tenant.id, { platformType: opt });
        setTenant(updated);
      } catch (e:any) { console.warn('updateTenant platformType:', e.message); }
      try { await addTenantErp(tenant.id, opt, opt); } catch (e:any) { if (!String(e.message).includes('already')) console.warn(e.message); }
      await refreshAll();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Onboard ERP connection"
        className="my-8 w-full max-w-2xl space-y-5 rounded-lg border border-line bg-panel p-6 shadow-xl"
      >

        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">Onboard ERP connection</h2>
            <p className="mt-1 text-sm text-ink-soft">Register the company, pick a channel, then connect.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Company */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="ERP entity name" htmlFor="onboard-name" error={nameError}>
              <Input
                id="onboard-name"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onBlur={() => setTouched(prev => ({ ...prev, companyName: true }))}
                placeholder="Acme Logistics Ltd"
                aria-invalid={!!nameError}
                className={nameError ? 'ring-1 ring-rose-500' : ''}
                required
              />
            </Field>

            <Field label="Tax identification number (TIN)" htmlFor="onboard-tin" error={tinError}>
              <Input
                id="onboard-tin"
                type="text"
                value={tin}
                onChange={(e) => setTin(e.target.value.toUpperCase())}
                onBlur={() => setTouched(prev => ({ ...prev, tin: true }))}
                placeholder="P099112233X"
                maxLength={11}
                aria-invalid={!!tinError}
                className={`font-mono uppercase ${tinError ? 'ring-1 ring-rose-500' : ''}`}
                required
              />
            </Field>
          </div>

          <Field label="Market tier" htmlFor="onboard-tier">
            <Select id="onboard-tier" value={marketTier} onChange={(e) => setMarketTier(e.target.value)}>
              <option value="Enterprise">Enterprise — 10,000 monthly invoices</option>
              <option value="Mid-Market">Mid-market — 5,000 monthly invoices</option>
              <option value="SMB Tier">SMB tier — 1,000 monthly invoices</option>
            </Select>
          </Field>
        </div>

        {/* Platform */}
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-ink-soft">Channel</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['QuickBooks Online','Odoo ERP'] as const).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => pickPlatform(opt)}
                aria-pressed={platformType === opt}
                className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                  platformType === opt ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel-muted'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {opt === 'QuickBooks Online'
                    ? <Zap className="h-3.5 w-3.5 text-accent" />
                    : <Layers className="h-3.5 w-3.5 text-ink-soft" />}
                  {opt}
                </span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  {opt === 'QuickBooks Online' ? 'OAuth, then automatic sync' : 'API key, then automatic sync'}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">Each ERP keeps its own connection and sync schedule. Add more later from this screen.</p>
        </fieldset>

        {tenant && (
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-panel-muted p-3 text-xs">
            <div>
              <dt className="text-ink-soft">Tenant ID</dt>
              <dd className="mt-0.5 truncate font-mono font-medium text-ink">{tenant?.id}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">Client entity</dt>
              <dd className="mt-0.5 truncate font-medium text-ink">{tenant?.name}</dd>
            </div>
          </dl>
        )}

        {/* Connect — QBO */}
        {isQbo && (
          <div className="space-y-3">
            {qboState === 'idle' && (
              <div className="space-y-3 rounded-lg border border-line bg-panel-muted p-5 text-center">
                <Plug className="mx-auto h-6 w-6 text-accent" strokeWidth={1.5} />
                <p className="mx-auto max-w-sm text-sm text-ink-soft">
                  Connect opens QuickBooks in a secure popup and authorises Citta Gateway to read invoices, customers and items.
                </p>
                <Button onClick={handleConnectQuickBooks}>
                  <Zap className="h-3.5 w-3.5" />
                  Connect QuickBooks
                </Button>
              </div>
            )}

            {qboState === 'connecting' && (
              <div className="space-y-2 rounded-lg border border-line bg-panel-muted p-5 text-center">
                <RefreshCw className="mx-auto h-5 w-5 animate-spin text-accent" />
                <p className="text-sm text-ink-soft">Waiting for authorisation in the popup window…</p>
              </div>
            )}

            {(qboState === 'connected' || qboState === 'syncing') && (
              <div className="space-y-2 rounded-lg border border-line bg-panel-muted p-5 text-center">
                <RefreshCw className="mx-auto h-5 w-5 animate-spin text-accent" />
                <p className="text-sm text-ink-soft">QuickBooks connected. Pulling historical invoices, customers and items…</p>
              </div>
            )}

            {qboState === 'synced' && (
              <Notice tone="ok" title="QuickBooks Online connected and synced">
                Found <strong className="font-medium text-ink">{qboSyncStats?.totalFound ?? 0}</strong> invoices: {qboSyncStats?.newSynced ?? 0} newly ingested, {qboSyncStats?.alreadySynced ?? 0} already on file.
              </Notice>
            )}

            {qboState === 'error' && (
              <Notice
                tone="fail"
                title="Connection issue"
                action={<Button size="sm" variant="secondary" onClick={handleConnectQuickBooks}>Try again</Button>}
              >
                {qboError}
              </Notice>
            )}
          </div>
        )}

        {/* Connect — Odoo */}
        {!isQbo && (
          <div className="space-y-3">
            {(odooState === 'idle' || odooState === 'error') && (
              <form onSubmit={handleConnectOdoo} className="space-y-3 rounded-lg border border-line bg-panel-muted p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Layers className="h-4 w-4 text-ink-soft" />
                  Connect Odoo instance
                </div>
                <p className="text-xs text-ink-soft">Generate an API key under Settings, Users, API Keys in the client's Odoo instance, then enter the details below.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="Odoo URL" htmlFor="odoo-url">
                      <Input id="odoo-url" type="url" required value={odooForm.odooUrl} onChange={e => setOdooForm(f => ({ ...f, odooUrl: e.target.value }))} placeholder="https://client.odoo.com" className="font-mono" />
                    </Field>
                  </div>
                  <Field label="Database" htmlFor="odoo-db">
                    <Input id="odoo-db" type="text" required value={odooForm.odooDatabase} onChange={e => setOdooForm(f => ({ ...f, odooDatabase: e.target.value }))} placeholder="odoo_prod" className="font-mono" />
                  </Field>
                  <Field label="Username or email" htmlFor="odoo-user">
                    <Input id="odoo-user" type="text" required value={odooForm.odooUsername} onChange={e => setOdooForm(f => ({ ...f, odooUsername: e.target.value }))} placeholder="integration@client.com" className="font-mono" />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="API key" htmlFor="odoo-key">
                      <Input id="odoo-key" type="password" required value={odooForm.odooApiKey} onChange={e => setOdooForm(f => ({ ...f, odooApiKey: e.target.value }))} placeholder="••••••••••••" className="font-mono" />
                    </Field>
                  </div>
                </div>
                {odooState === 'error' && <Notice tone="fail">{odooError}</Notice>}
                <Button type="submit" className="w-full">
                  <Layers className="h-3.5 w-3.5" />
                  {companySaved ? 'Connect and sync Odoo' : 'Save company and connect Odoo'}
                </Button>
              </form>
            )}

            {(odooState === 'connecting' || odooState === 'syncing') && (
              <div className="space-y-2 rounded-lg border border-line bg-panel-muted p-5 text-center">
                <RefreshCw className="mx-auto h-5 w-5 animate-spin text-accent" />
                <p className="text-sm text-ink-soft">
                  {odooState === 'connecting' ? 'Authenticating with Odoo…' : 'Odoo connected. Pulling historical invoices, customers and items…'}
                </p>
              </div>
            )}

            {odooState === 'synced' && (
              <Notice tone="ok" title="Odoo ERP connected and synced">
                Found <strong className="font-medium text-ink">{odooSyncStats?.totalFound ?? 0}</strong> invoices: {odooSyncStats?.newSynced ?? 0} newly ingested, {odooSyncStats?.alreadySynced ?? 0} already on file.
              </Notice>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs text-ink-soft">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" />
            Row-level tenant isolation. CittaEFS key mapped on create.
          </p>
          <Button variant="secondary" onClick={onClose}>
            {(qboState === 'synced' || odooState === 'synced') ? `Done — go to ${tenant?.name}` : 'Finish later'}
          </Button>
        </div>

      </div>
    </div>
  );
}
