import { useState, useEffect } from 'react';
import { useHub } from '../../lib/store';
import { getErpForTenant } from '../../config/erpRegistry';
import { Save, Sliders, AlertCircle, CheckCircle2, Tag, Key } from 'lucide-react';
import { fetchWithAuth, parseJsonResponse } from '../../lib/api';

export function ErpMappingTab() {
  const { activeTenant, refreshAll } = useHub();
  const erp = getErpForTenant(activeTenant.platformType);
  const initial = (() => { try { return JSON.parse(activeTenant.erpConfig || '{}'); } catch { return {}; } })();
  const [config, setConfig] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [fieldRules, setFieldRules] = useState<{ source: string; target: string; note?: string }[]>(() => {
    const saved = (initial as any)._rules;
    if (Array.isArray(saved) && saved.length) return saved;
    return erp.matching.slice(0, 3).map(m => { const [s,t] = m.split('↔').map(x=>x.trim()); return { source: s||'', target: t||'', note: '' }; });
  });

  useEffect(() => {
    try { setConfig(JSON.parse(activeTenant.erpConfig || '{}')); } catch { setConfig({}); }
  }, [activeTenant.id]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload = { ...config, _rules: fieldRules };
      const res = await fetchWithAuth(`/api/tenants/${activeTenant.id}/erp-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erpConfig: JSON.stringify(payload) }),
      });
      await parseJsonResponse(res);
      await refreshAll();
      setMsg({ type: 'success', text: 'ERP mapping & configuration saved for this workspace. Resolutions will use these rules.' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-indigo-400" />
          <h1 className="text-base font-bold tracking-tight">{erp.label} — Field Mapping & Resolution</h1>
        </div>
        <p className="text-slate-400 text-xs mt-1">Per-ERP dedicated matching, transformation rules, and error resolution. Stored per tenant in <span className="font-mono text-indigo-300">erpConfig</span>.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5 shadow-sm">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><Key className="w-4 h-4 text-indigo-600" /> ERP Connection Config</h3>
        {erp.configFields.length === 0 ? (
          <p className="text-slate-500">No extra config for this ERP — mapping below is sufficient.</p>
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

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900 flex items-center gap-2"><Tag className="w-4 h-4 text-indigo-600" /> Field Mapping Rules <span className="text-[11px] font-normal text-slate-500">({fieldRules.length})</span></h3>
          <button onClick={() => setFieldRules([...fieldRules, { source: '', target: '' }])} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-xs cursor-pointer">+ Add Rule</button>
        </div>
        <p className="text-slate-500 text-xs">Source (ERP field) ↔ Target (CittaEFS EFS matrix). Used for normalization and for the Validation → Auto-fix suggestions.</p>
        <div className="space-y-2">
          {fieldRules.map((r, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-7 gap-2 items-center bg-slate-50 p-3 rounded-lg border border-slate-200/70">
              <input value={r.source} onChange={e => setFieldRules(fieldRules.map((x,i)=> i===idx?{...x, source:e.target.value}:x))} placeholder="Source (e.g. DocNumber)" className="sm:col-span-3 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono" />
              <span className="text-center text-slate-400 font-bold">↔</span>
              <input value={r.target} onChange={e => setFieldRules(fieldRules.map((x,i)=> i===idx?{...x, target:e.target.value}:x))} placeholder="Target (e.g. clientInvoiceNumber)" className="sm:col-span-2 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono" />
              <button onClick={() => setFieldRules(fieldRules.filter((_,i)=>i!==idx))} className="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200 text-xs cursor-pointer">Delete</button>
            </div>
          ))}
        </div>
        {erp.comingSoon && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-amber-900 text-xs"><AlertCircle className="w-4 h-4 text-amber-600 shrink-0" /><span>Coming-soon ERP: these rules are stored now and will activate when the adapter ships.</span></div>
        )}
      </div>

      <div className="flex justify-end items-center gap-3">
        {msg && <span className={`text-xs font-medium ${msg.type==='success'?'text-emerald-700':'text-rose-700'} flex items-center gap-1`}>{msg.type==='success'?<CheckCircle2 className="w-3.5 h-3.5"/>:<AlertCircle className="w-3.5 h-3.5"/>}{msg.text}</span>}
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer flex items-center gap-2"><Save className="w-3.5 h-3.5" /><span>{saving?'Saving...':'Save Mapping & Config'}</span></button>
      </div>
    </div>
  );
}
