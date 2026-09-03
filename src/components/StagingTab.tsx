import { useEffect, useState } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { toastGlobal } from './ui/Toast';
import { Layers, Clock, CheckCircle2, AlertTriangle, RotateCcw, Send, Pencil, Database, RefreshCw } from 'lucide-react';
import { getRowErrors } from '../lib/invoiceValidation';

export function StagingTab() {
  const { activeTenant, refreshAll, retryBulkInvoices, isBgRefreshing } = useHub() as any;
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const isAnyPropagating = retrying || isBgRefreshing;
  const [propagatingSince, setPropagatingSince] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (isAnyPropagating && propagatingSince === null) setPropagatingSince(Date.now());
    if (!isAnyPropagating) { setPropagatingSince(null); setElapsedSec(0); }
  }, [isAnyPropagating, propagatingSince]);
  useEffect(() => {
    if (!isAnyPropagating || propagatingSince === null) return;
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - propagatingSince) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isAnyPropagating, propagatingSince]);

  const load = async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/staging/summary?tenantId=${activeTenant.id}`);
      const data = await parseJsonResponse(res);
      setSummary(data);
    } catch (e:any) { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(()=>{ load(); }, [activeTenant?.id]);

  const handleBulkRetry = async () => {
    if (!summary?.counts?.rejected && summary?.dlqPreview?.length===0) { toastGlobal('info','Nothing to retry','No REJECTED/DLQ'); return; }
    setRetrying(true);
    try {
      await retryBulkInvoices(activeTenant.id);
      await load();
      await refreshAll();
    } finally { setRetrying(false); }
  };

  const handleRetryAllPending = async () => {
    // Re-queue all pending via bulk retry (covers PENDING_NRS_STAMP stuck)
    setRetrying(true);
    try {
      const res = await fetchWithAuth('/api/invoices/retry-bulk', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenantId: activeTenant.id, statusFilter: 'PENDING_NRS_STAMP' })});
      await parseJsonResponse(res);
      toastGlobal('success','Pending re-queued','All pending staging invoices refreshed to queue');
      await load();
      await refreshAll();
    } catch (e:any){ toastGlobal('error','Retry failed', e.message); } finally { setRetrying(false); }
  };

  if (!activeTenant) return <div className="p-8 text-center text-slate-500 text-xs">Select a workspace</div>;

  const pending = summary?.pendingPreview || [];
  const dlq = summary?.dlqPreview || [];
  const counts = summary?.counts || { pending:0, approved:0, rejected:0, queued:0, dlqCount:0 };
  const queue = summary?.queue || { engine:'db-memory', queued:0, failedInDLQ:0 };

  return (
    <div className="space-y-6 font-sans text-xs">
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500 rounded-xl text-slate-950"><Layers className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">Staging <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-full text-[10px]">PRE-TRANSMISSION</span></h2>
            <p className="text-slate-400 text-xs mt-1">Holding area before CittaEFS gateway — review, normalize, then send. Distinct from <strong className="text-amber-300">Validation</strong> (post-failure).</p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-sans">
          <button onClick={load} disabled={loading || retrying || isBgRefreshing} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg border border-white/10 flex items-center gap-1.5 cursor-pointer font-sans text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:grayscale"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`} /> Refresh</button>
          <button onClick={handleBulkRetry} disabled={retrying || loading || isBgRefreshing} className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer font-sans text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:grayscale"><RotateCcw className={`w-3.5 h-3.5 ${retrying?'animate-spin':''}`} /> Retry DLQ</button>
          <button onClick={handleRetryAllPending} disabled={retrying || loading || isBgRefreshing || counts.pending===0} className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer font-sans text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:grayscale shadow-sm"><Send className="w-3.5 h-3.5" /> Re-queue Pending ({counts.pending})</button>
        </div>
      </div>

      {isAnyPropagating && (
        <div className="p-3 rounded-xl border border-violet-300 bg-violet-600 text-white flex items-center justify-between gap-3 font-sans shadow-sm">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 animate-spin text-violet-200" />
            <span className="text-xs font-bold tracking-tight">Propagating to CittaEFS…</span>
            <span className="px-2 py-0.5 bg-white/20 rounded-full text-[11px] font-mono font-bold">{elapsedSec}s elapsed</span>
            <span className="hidden sm:inline text-[11px] text-violet-100">Buttons dulled until feedback</span>
          </div>
          <span className="text-[11px] font-mono bg-white/15 px-2 py-1 rounded">Hub → ei-api.azurewebsites.net</span>
        </div>
      )}

      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${isAnyPropagating ? 'opacity-60 blur-[0.5px] pointer-events-none select-none' : ''}`}>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500">Pending Staging</div>
          <div className="text-2xl font-black text-amber-600 mt-1">{counts.pending}</div>
          <div className="text-[11px] text-slate-500">Queued {counts.queued} • Engine {queue.engine}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500">Approved</div>
          <div className="text-2xl font-black text-emerald-600 mt-1">{counts.approved}</div>
          <div className="text-[11px] text-slate-500">IRN stamped</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500">Rejected / DLQ</div>
          <div className="text-2xl font-black text-rose-600 mt-1">{counts.rejected} <span className="text-sm font-bold text-slate-400">/ {counts.dlqCount} DLQ</span></div>
          <div className="text-[11px] text-slate-500">See Validation tab for fix</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500 flex items-center gap-1"><Database className="w-3 h-3" /> Queue</div>
          <div className="text-xs font-mono mt-1">{queue.queued} queued • {queue.processing} processing • {queue.failedInDLQ} DLQ</div>
          <div className="text-[11px] text-slate-500">{queue.bullMqReady ? 'BullMQ Redis' : 'DB-memory • 5s tick • 5× retry 5s/30s/2m/10m/30m'}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
        <div className="px-5 py-3 bg-slate-900 text-white flex items-center justify-between">
          <h3 className="text-xs font-bold flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" /> Staging Queue — {pending.length} pending (preview 50)</h3>
          <span className="text-[11px] text-slate-400">{activeTenant.name} • DocNumber is source of truth • review HS/TIN before send</span>
        </div>
        {pending.length===0 ? (
          <div className="p-8 text-center text-slate-500">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">Staging is empty — all caught up</p>
            <p className="text-xs mt-1">New QBO syncs (when auto-enqueue OFF) and Excel uploads land here. Invoices in Invoices tab with <strong>PENDING_NRS_STAMP</strong> also appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 border-b">
                <tr><th className="py-2 px-3">Invoice #</th><th className="py-2 px-3">Source</th><th className="py-2 px-3">Date</th><th className="py-2 px-3">Customer</th><th className="py-2 px-3">TIN</th><th className="py-2 px-3">Lines</th><th className="py-2 px-3">Total</th><th className="py-2 px-3">Normalize</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((inv:any)=>{
                  const errs = getRowErrors({ clientInvoiceNumber: inv.clientInvoiceNumber, issueDate: inv.issueDate?.substring(0,10), customerCode: inv.customerCode, customerName: inv.customerName, customerTin: inv.customerTin||'', invoiceKind: inv.invoiceKind, itemCode: inv.lineItems?.[0]?.itemCode||'', hsOrServiceCode: inv.lineItems?.[0]?.hsOrServiceCode||'', quantity: inv.lineItems?.[0]?.quantity, unitPrice: inv.lineItems?.[0]?.unitPrice, vatRate: inv.lineItems?.[0]?.vatRate } as any);
                  return (
                    <tr key={inv.id} className={errs.length? 'bg-amber-50/50':''}>
                      <td className="py-2 px-3 font-mono font-semibold">{inv.clientInvoiceNumber}</td>
                      <td className="py-2 px-3"><span className="px-2 py-0.5 rounded-full border text-[10px] font-bold bg-slate-100">{inv.sourceErp || '—'}</span> {inv.qboInvoiceId ? <span className="font-mono text-[10px] text-slate-500">qbo:{inv.qboInvoiceId}</span>:null}</td>
                      <td className="py-2 px-3">{inv.issueDate?.substring(0,10)}</td>
                      <td className="py-2 px-3">{inv.customerName}<span className="text-slate-400"> ({inv.customerCode})</span></td>
                      <td className="py-2 px-3 font-mono">{inv.customerTin || 'N/A'}</td>
                      <td className="py-2 px-3 text-center">{inv.lineItems?.length}</td>
                      <td className="py-2 px-3 text-right">NGN {Number(inv.totalAmount||0).toLocaleString()}</td>
                      <td className="py-2 px-3">{errs.length ? <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errs[0].slice(0,60)}</span> : <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> OK</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dlq.length>0 && (
        <div className="bg-white rounded-xl border border-rose-200 overflow-hidden">
          <div className="px-5 py-3 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
            <h3 className="text-xs font-bold text-rose-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> DLQ — {dlq.length} gateway failures (auto 5× exhausted)</h3>
            <span className="text-[11px] text-rose-700">Use Retry buttons in Invoices tab or Staging header</span>
          </div>
          <div className="divide-y divide-rose-100 text-xs">
            {dlq.map((j:any)=>(
              <div key={j.id} className="p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono font-semibold">{j.id}</div>
                  <div className="text-slate-600">{j.lastError}</div>
                </div>
                <span className="text-[10px] font-mono text-slate-500">{new Date(j.createdAt).toLocaleString()} • {j.attempts} attempts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-xs space-y-1">
        <p className="font-bold text-indigo-900">Staging vs Validation — how they differ</p>
        <ul className="list-disc list-inside text-indigo-800 space-y-1">
          <li><strong>Staging</strong> (this tab): <em>pre-transmission</em> holding area — invoices are <code className="bg-white px-1 rounded">PENDING_NRS_STAMP</code> in Hub, not yet sent to CittaEFS. You review HS/TIN, edit, approve/re-queue. Source: QBO preview inbox (when auto-enqueue OFF) + Excel import + any pending in Invoices.</li>
          <li><strong>Validation</strong> tab: <em>post-failure</em> — gateway or pre-flight rejections (`REJECTED`) with `errorCategory` + 1-click fix. Staging feeds Validation on failure.</li>
          <li>With the new retry logic, <strong>Validation suffices for error triage</strong>, but <strong>Staging adds operational clarity</strong> — it is the inbox operators watch. Recommendation: keep both. If you prefer minimalism, we can fold Staging counts into Validation header and hide this tab for OPERATOR.</li>
        </ul>
      </div>
    </div>
  );
}
