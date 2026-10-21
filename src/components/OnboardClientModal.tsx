import { useState, useEffect, useRef, FormEvent } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse, getApiBaseUrl } from '../lib/api';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  Zap,
  Layers,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

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
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto font-sans text-xs">
      <div className="bg-white max-w-2xl w-full p-6 text-slate-900 space-y-5 rounded-lg border border-slate-200 shadow-xl relative my-8">

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-700" />
              Onboard ERP Connection
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Register the company, pick a channel (QBO or Odoo), and connect — all in one step.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer font-medium p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Company */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">ERP Entity Name *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onBlur={() => setTouched(prev => ({ ...prev, companyName: true }))}
                placeholder="e.g. Acme Logistics Ltd"
                className={`w-full px-3.5 py-2 border rounded-lg font-medium text-slate-900 focus:outline-none focus:ring-2 transition-all ${
                  nameError ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-500' : 'border-slate-200 focus:ring-emerald-600/20 focus:border-emerald-600'
                }`}
                required
              />
              {nameError && <p className="text-rose-600 text-[11px] mt-1">{nameError}</p>}
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Tax Identification Number (TIN) *</label>
              <input
                type="text"
                value={tin}
                onChange={(e) => setTin(e.target.value.toUpperCase())}
                onBlur={() => setTouched(prev => ({ ...prev, tin: true }))}
                placeholder="e.g. P099112233X"
                maxLength={11}
                className={`w-full px-3.5 py-2 border rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 transition-all uppercase ${
                  tinError ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-500' : 'border-slate-200 focus:ring-emerald-600/20 focus:border-emerald-600'
                }`}
                required
              />
              {tinError && <p className="text-rose-600 text-[11px] mt-1">{tinError}</p>}
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Market Tier / Processing Allowance *</label>
            <select
              value={marketTier}
              onChange={(e) => setMarketTier(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all cursor-pointer"
            >
              <option value="Enterprise">Enterprise (10,000 monthly invoices)</option>
              <option value="Mid-Market">Mid-Market (5,000 monthly invoices)</option>
              <option value="SMB Tier">SMB Tier (1,000 monthly invoices)</option>
            </select>
          </div>
        </div>

        {/* Platform */}
        <div>
          <label className="block font-medium text-slate-700 mb-2 text-xs">Channel — pick the client's ERP *</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['QuickBooks Online','Odoo ERP'] as const).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => pickPlatform(opt)}
                className={`p-3 rounded-lg border-2 text-left cursor-pointer ${platformType===opt ? 'bg-emerald-50 border-emerald-700 ring-2 ring-emerald-600/20' : 'bg-white border-slate-200 hover:border-slate-300'}`}
              >
                <span className="font-bold text-xs flex items-center gap-2">{opt==='QuickBooks Online' ? <Zap className="w-3.5 h-3.5 text-amber-500"/> : <Layers className="w-3.5 h-3.5 text-slate-900"/>}{opt}</span>
                <span className="text-[11px] text-slate-500">{opt==='QuickBooks Online' ? 'OAuth + auto sync' : 'API key + auto sync'}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">You can add more ERPs later in Admin → Companies & ERPs. Each ERP keeps isolated config & pull.</p>
        </div>

        {tenant && (
          <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/80 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500 font-medium text-[11px] block">Tenant ID</span>
              <span className="font-mono font-bold text-slate-900">{tenant?.id}</span>
            </div>
            <div>
              <span className="text-slate-500 font-medium text-[11px] block">Client Entity</span>
              <span className="font-bold text-slate-900">{tenant?.name}</span>
            </div>
          </div>
        )}

        {/* Connect — QBO */}
        {isQbo && (
          <div className="space-y-3">
            {qboState === 'idle' && (
              <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/80 text-center space-y-3">
                <Zap className="w-8 h-8 text-amber-500 mx-auto" />
                <p className="text-slate-600 text-xs leading-relaxed max-w-sm mx-auto">
                  Click connect to open QuickBooks in a secure popup and authorize Citta Gateway to read invoices, customers, and items.
                </p>
                <button
                  onClick={handleConnectQuickBooks}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center gap-2 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Connect QuickBooks</span>
                </button>
              </div>
            )}

            {qboState === 'connecting' && (
              <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/80 text-center space-y-2">
                <RefreshCw className="w-6 h-6 text-emerald-700 mx-auto animate-spin" />
                <p className="text-slate-600 text-xs">Waiting for authorization in the popup window...</p>
              </div>
            )}

            {(qboState === 'connected' || qboState === 'syncing') && (
              <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/80 text-center space-y-2">
                <RefreshCw className="w-6 h-6 text-emerald-700 mx-auto animate-spin" />
                <p className="text-slate-600 text-xs">QuickBooks connected. Pulling historical invoices, customers, and items...</p>
              </div>
            )}

            {qboState === 'synced' && (
              <div className="p-4 bg-emerald-50 text-emerald-900 rounded-lg border border-emerald-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  <span>QuickBooks Online Connected & Synced!</span>
                </div>
                <p className="text-xs">
                  Found <strong>{qboSyncStats?.totalFound ?? 0}</strong> invoices &mdash;
                  {' '}<strong>{qboSyncStats?.newSynced ?? 0}</strong> newly ingested,
                  {' '}<strong>{qboSyncStats?.alreadySynced ?? 0}</strong> already on file.
                </p>
              </div>
            )}

            {qboState === 'error' && (
              <div className="p-4 bg-rose-50 text-rose-900 rounded-lg border border-rose-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertCircle className="w-5 h-5 text-rose-600" />
                  <span>Connection Issue</span>
                </div>
                <p className="text-xs">{qboError}</p>
                <button
                  onClick={handleConnectQuickBooks}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg cursor-pointer transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Connect — Odoo */}
        {!isQbo && (
          <div className="space-y-3">
            {(odooState === 'idle' || odooState === 'error') && (
              <form onSubmit={handleConnectOdoo} className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/80 space-y-3">
                <div className="flex items-center gap-2 text-slate-700 font-semibold">
                  <Layers className="w-5 h-5 text-slate-900" />
                  <span>Connect Odoo Instance</span>
                </div>
                <p className="text-slate-500 text-[11px]">Generate an API key under Settings → Users → API Keys in the client's Odoo instance, then enter their details below.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Odoo URL *</label>
                    <input type="url" required value={odooForm.odooUrl} onChange={e => setOdooForm(f => ({ ...f, odooUrl: e.target.value }))} placeholder="https://client.odoo.com" className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all" />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Database *</label>
                    <input type="text" required value={odooForm.odooDatabase} onChange={e => setOdooForm(f => ({ ...f, odooDatabase: e.target.value }))} placeholder="odoo_prod" className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all" />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Username / Email *</label>
                    <input type="text" required value={odooForm.odooUsername} onChange={e => setOdooForm(f => ({ ...f, odooUsername: e.target.value }))} placeholder="integration@client.com" className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">API Key *</label>
                    <input type="password" required value={odooForm.odooApiKey} onChange={e => setOdooForm(f => ({ ...f, odooApiKey: e.target.value }))} placeholder="••••••••••••" className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all" />
                  </div>
                </div>
                {odooState === 'error' && (
                  <div className="p-3 bg-rose-50 text-rose-900 rounded-lg border border-rose-200 flex items-start gap-2 text-xs">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{odooError}</span>
                  </div>
                )}
                <button type="submit" className="w-full px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center justify-center gap-2 transition-colors">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <span>{companySaved ? 'Connect & Sync Odoo' : 'Save Company & Connect Odoo'}</span>
                </button>
              </form>
            )}

            {(odooState === 'connecting' || odooState === 'syncing') && (
              <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/80 text-center space-y-2">
                <RefreshCw className="w-6 h-6 text-emerald-700 mx-auto animate-spin" />
                <p className="text-slate-600 text-xs">{odooState === 'connecting' ? 'Authenticating with Odoo...' : 'Odoo connected. Pulling historical invoices, customers, and items...'}</p>
              </div>
            )}

            {odooState === 'synced' && (
              <div className="p-4 bg-emerald-50 text-emerald-900 rounded-lg border border-emerald-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  <span>Odoo ERP Connected & Synced!</span>
                </div>
                <p className="text-xs">
                  Found <strong>{odooSyncStats?.totalFound ?? 0}</strong> invoices &mdash;
                  {' '}<strong>{odooSyncStats?.newSynced ?? 0}</strong> newly ingested,
                  {' '}<strong>{odooSyncStats?.alreadySynced ?? 0}</strong> already on file.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span>Row-level tenant isolation · CittaEFS key mapped on create</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg cursor-pointer transition-colors"
          >
            {(qboState === 'synced' || odooState === 'synced') ? `Done — go to ${tenant?.name}` : 'Finish Later & Close'}
          </button>
        </div>

      </div>
    </div>
  );
}
