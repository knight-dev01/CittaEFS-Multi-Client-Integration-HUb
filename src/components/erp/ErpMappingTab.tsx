import { useState, useEffect } from 'react';
import { useHub } from '../../lib/store';
import { getErpForTenant } from '../../config/erpRegistry';
import { Save, Key, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchWithAuth, parseJsonResponse } from '../../lib/api';

export function ErpMappingTab() {
  const { activeTenant, refreshAll } = useHub();
  const erp = getErpForTenant(activeTenant.platformType);
  const initial = (() => { try { return JSON.parse(activeTenant.erpConfig || '{}'); } catch { return {}; } })();
  const [config, setConfig] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    try { setConfig(JSON.parse(activeTenant.erpConfig || '{}')); } catch { setConfig({}); }
  }, [activeTenant.id]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetchWithAuth(`/api/tenants/${activeTenant.id}/erp-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erpConfig: JSON.stringify(config) }),
      });
      await parseJsonResponse(res);
      await refreshAll();
      setMsg({ type: 'success', text: 'ERP configuration saved for this workspace.' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-emerald-700" />
          <h3 className="font-bold text-slate-900">{erp.label} — Connection Config</h3>
        </div>
        <p className="text-slate-500 text-xs">Stored per tenant in <span className="font-mono text-emerald-700">erpConfig</span>. Credentials are set at connect time; these are runtime settings.</p>
        {erp.configFields.length === 0 ? (
          <p className="text-slate-500">No editable config for this ERP.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {erp.configFields.map(f => (
              <div key={f.key}>
                <label className="block font-medium text-slate-700 mb-1">{f.label}</label>
                {f.type === 'select' ? (
                  <select value={config[f.key] || ''} onChange={e => setConfig({ ...config, [f.key]: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs cursor-pointer">
                    <option value="">— select —</option>
                    {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'} value={config[f.key] || ''} onChange={e => setConfig({ ...config, [f.key]: e.target.value })} placeholder={f.hint} className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono text-xs" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end items-center gap-3">
        {msg && <span className={`text-xs font-medium ${msg.type==='success'?'text-emerald-700':'text-rose-700'} flex items-center gap-1`}>{msg.type==='success'?<CheckCircle2 className="w-3.5 h-3.5"/>:<AlertCircle className="w-3.5 h-3.5"/>}{msg.text}</span>}
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer flex items-center gap-2"><Save className="w-3.5 h-3.5" /><span>{saving?'Saving...':'Save Config'}</span></button>
      </div>
    </div>
  );
}
