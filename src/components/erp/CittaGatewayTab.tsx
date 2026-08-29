import { useState, useEffect } from 'react';
import { useHub } from '../../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../../lib/api';
import { ShieldCheck, Key, Globe, Save, CheckCircle2, AlertCircle, Building2, Plug, Eye, EyeOff } from 'lucide-react';
import { getErpForTenant } from '../../config/erpRegistry';

export function CittaGatewayTab() {
  const { activeTenant, refreshAll } = useHub();
  const erp = getErpForTenant(activeTenant.platformType);
  const [gatewayUrl, setGatewayUrl] = useState(activeTenant.cittaGatewayUrl || 'https://ei-api.azurewebsites.net');
  const [apiKey, setApiKey] = useState(activeTenant.cittaApiKey || '');
  const [writebackTarget, setWritebackTarget] = useState(activeTenant.cittaWritebackTarget || 'HUB');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setGatewayUrl(activeTenant.cittaGatewayUrl || 'https://ei-api.azurewebsites.net');
    setApiKey(activeTenant.cittaApiKey || '');
    setWritebackTarget((activeTenant as any).cittaWritebackTarget || 'HUB');
  }, [activeTenant.id]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetchWithAuth(`/api/tenants/${activeTenant.id}/citta-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cittaGatewayUrl: gatewayUrl.trim() || null, cittaApiKey: apiKey.trim() || undefined, cittaWritebackTarget: writebackTarget }),
      });
      await parseJsonResponse(res);
      await refreshAll();
      setMsg({ type: 'success', text: 'CittaEFS gateway credentials saved for this tenant. Normalized invoices will be sent here after hub processing.' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetchWithAuth(`/api/tenants/${activeTenant.id}/citta-config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cittaGatewayUrl, cittaApiKey: apiKey }),
      });
      const data = await parseJsonResponse(res);
      setMsg({ type: data.success ? 'success' : 'error', text: data.message || (data.success ? 'Gateway reachable (HTTP 200). Writeback will succeed.' : 'Gateway test failed.') });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message });
    } finally { setTesting(false); }
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          <h1 className="text-base font-bold tracking-tight">CittaEFS Integration Credentials & Writeback</h1>
        </div>
        <p className="text-slate-400 text-xs mt-1">Single shared gateway key — <span className="text-violet-300 font-semibold">all tenants send through ONE CittaEFS API key</span> (<span className="font-mono text-violet-300">CITTAEFS_API_KEY</span> env if set, else DB shared pool). Hub normalizes from <span className="text-white font-medium">{erp.label}</span> → fiscal matrix → sends to CittaEFS, then writes IRN/QR back to <span className="text-white font-medium">{writebackTarget === 'BOTH' ? 'CittaEFS + Hub' : writebackTarget === 'CITTAEFS' ? 'CittaEFS only' : 'Hub only'}</span>.</p>
        <div className="mt-3 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2 text-xs text-violet-200">All tenants share one gateway. Saving here propagates the key & URL to every tenant. Set <span className="font-mono text-violet-300">CITTAEFS_API_KEY</span> in env (Render Secret File) to override DB at runtime.</div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-bold text-slate-900 flex items-center gap-2"><Building2 className="w-4 h-4 text-indigo-600" /> Tenant Workspace</h3>
          <span className="text-[11px] font-mono px-2 py-1 bg-slate-100 rounded border border-slate-200">{activeTenant.id}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 block">Tenant</span>
            <span className="font-bold text-slate-900">{activeTenant.name}</span>
            <span className="text-[11px] text-slate-500 block">{activeTenant.platformType}</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 block">ERP Mode</span>
            <span className="font-bold text-slate-900 flex items-center gap-1.5"><erp.icon className="w-3.5 h-3.5" />{erp.label}</span>
            <span className="text-[11px] text-slate-500">{erp.description}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5 shadow-sm">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><Globe className="w-4 h-4 text-indigo-600" /> CittaEFS Gateway Credentials — Single Shared Key (provided by CittaEFS)</h3>
        <p className="text-slate-500 text-xs">One key for all tenants. Hub reads <span className="font-mono bg-slate-100 px-1 py-0.5 rounded border">CITTAEFS_API_KEY</span> env first (recommended: set in Render Secret File), otherwise the DB shared pool. Saving here updates <span className="font-semibold">every</span> tenant so they stay in sync. Env always wins at runtime.</p>

        <div className="space-y-4">
          <div>
            <label className="block font-medium text-slate-700 mb-1">CittaEFS Gateway Base URL — shared</label>
            <input value={gatewayUrl} onChange={e => setGatewayUrl(e.target.value)} placeholder="https://ei-api.azurewebsites.net" className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none" />
            <span className="text-[11px] text-slate-500">Shared by all tenants. Env <span className="font-mono">CITTAEFS_GATEWAY_URL</span> overrides this. Saving propagates to every tenant.</span>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1 flex items-center gap-2"><Key className="w-3.5 h-3.5" /> CittaEFS API Key — Shared (all tenants)</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk_live_..." className="w-full px-3.5 py-2 pr-9 border border-slate-200 rounded-lg font-mono text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none" />
                <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-slate-100 text-slate-500 cursor-pointer">{showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
              </div>
              <button onClick={handleTest} disabled={testing || !apiKey} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center gap-1.5"><Plug className="w-3.5 h-3.5" /><span>{testing ? 'Testing...' : 'Test'}</span></button>
            </div>
            <span className="text-[11px] text-slate-500">Shared by all tenants. Rotating here rotates for everyone. Recommended: set <span className="font-mono">CITTAEFS_API_KEY</span> env var instead — env takes precedence and survives restarts. Never commit to git.</span>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Writeback Target — where to write IRN/QR after NRS stamp (per tenant, but gateway is shared)</label>
            <select value={writebackTarget} onChange={e => setWritebackTarget(e.target.value)} className="w-full px-3.5 py-2 border border-slate-200 rounded-lg bg-white text-xs cursor-pointer">
              <option value="HUB">Hub only (ledgerWritebackStatus = SYNCED in hub DB) — default</option>
              <option value="CITTAEFS">CittaEFS only (POST IRN/QR to CittaEFS writeback URL)</option>
              <option value="BOTH">Both — Hub + CittaEFS (recommended)</option>
            </select>
            <span className="text-[11px] text-slate-500">Hub always persists IRN/QR. CITTAEFS/BOTH also call the CittaEFS writeback endpoint after stamping. Configure the endpoint URL in erpConfig if CittaEFS provides one.</span>
          </div>
        </div>

        <div className="flex justify-end items-center gap-3 pt-3 border-t border-slate-100">
          {msg && <span className={`text-xs font-medium flex items-center gap-1 ${msg.type==='success'?'text-emerald-700':'text-rose-700'}`}>{msg.type==='success'?<CheckCircle2 className="w-3.5 h-3.5"/>:<AlertCircle className="w-3.5 h-3.5"/>}{msg.text}</span>}
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer flex items-center gap-2"><Save className="w-3.5 h-3.5" /><span>{saving ? 'Saving...' : 'Save & Propagate to All Tenants'}</span></button>
        </div>
      </div>

      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-xs text-indigo-900 space-y-2">
        <span className="font-bold flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> How it works</span>
        <ol className="list-decimal list-inside space-y-1 text-indigo-800">
          <li><strong>Hub normalizes</strong> ERP data (QBO/Excel/…) → EFS fiscal matrix (clientInvoiceNumber, HS, VAT, TIN).</li>
          <li><strong>Hub sends</strong> normalized payload to <span className="font-mono bg-white px-1 py-0.5 rounded border border-indigo-200">{gatewayUrl || 'https://ei-api.azurewebsites.net'}/api/integration/gen/invoices</span> with the <span className="font-semibold">single shared</span> Bearer key (<span className="font-mono">CITTAEFS_API_KEY</span> env wins over DB).</li>
          <li><strong>CittaEFS/NRS stamps</strong> IRN + QR. Hub persists IRN/QR and — per writeback target — writes back to Hub ledger and/or CittaEFS.</li>
        </ol>
      </div>
    </div>
  );
}
