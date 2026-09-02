import { useEffect, useState } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { getRowErrors } from '../lib/invoiceValidation';
import { CheckCircle2, AlertCircle, Play, RefreshCw, Eye } from 'lucide-react';
import { toastGlobal } from './ui/Toast';

export function QboStagingInbox({ tenantId }: { tenantId: string }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [msg, setMsg] = useState<string|null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [erpId, setErpId] = useState<string|null>(null);
  const [autoEnqueue, setAutoEnqueue] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [invRes, erpRes] = await Promise.all([
        fetchWithAuth(`/api/tenants/${tenantId}/qbo-staging`).catch(()=>null),
        fetchWithAuth(`/api/tenants/${tenantId}/erps`).catch(()=>null),
      ]);
      if (invRes) {
        const data = await parseJsonResponse<any[]>(invRes);
        setInvoices(Array.isArray(data) ? data : []);
        setSelected(new Set());
      }
      if (erpRes) {
        const erps:any[] = await parseJsonResponse<any[]>(erpRes);
        const qbo = erps.find(e=> e.platformType==='QuickBooks Online');
        if (qbo) { setErpId(qbo.id); setAutoEnqueue(!!qbo.autoEnqueueQbo); }
      }
    } catch (e:any) { setMsg(e.message); } finally { setLoading(false); }
  };
  useEffect(()=>{ if(tenantId) load(); },[tenantId]);

  const toggleAuto = async () => {
    if (!erpId) { setMsg('QBO ERP not found for this tenant'); return; }
    try {
      const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps/${erpId}/auto-enqueue`,{ method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ autoEnqueueQbo: !autoEnqueue })});
      await parseJsonResponse(res);
      setAutoEnqueue(!autoEnqueue);
      toastGlobal('success', `Auto-enqueue ${!autoEnqueue?'enabled':'disabled'}`, 'QBO invoices will ' + (!autoEnqueue ? 'auto-forward to CittaEFS' : 'require preview approval'));
    } catch(e:any){ toastGlobal('error','Toggle failed', e.message); }
  };

  const toggle = (id:string) => {
    setSelected(prev=>{ const n=new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const approve = async () => {
    setApproving(true);
    try {
      const ids = selected.size ? Array.from(selected) : undefined;
      const res = await fetchWithAuth(`/api/tenants/${tenantId}/qbo-staging/approve`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ invoiceIds: ids })
      });
      const data = await parseJsonResponse<any>(res);
      toastGlobal('success', `Approved ${data.queued} QBO invoice(s) to CittaEFS`, 'Queued for NRS stamping');
      setMsg(`Approved ${data.queued}/${data.total} — queued to CittaEFS. Watch Invoices tab for IRN.`);
      await load();
    } catch(e:any){ toastGlobal('error','Approve failed', e.message); setMsg(e.message);} finally { setApproving(false); }
  };

  if (!tenantId) return <div className="p-4 text-xs text-slate-500">Select a tenant to view QBO staging inbox.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm flex items-center gap-2"><Eye className="w-4 h-4 text-indigo-600"/> QBO Staging Inbox — Preview before CittaEFS</h3>
        <div className="flex items-center gap-2">
          <button onClick={toggleAuto} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${autoEnqueue?'bg-emerald-600 text-white border-emerald-700':'bg-white text-slate-700 border-slate-200'}`}>{autoEnqueue?'Auto-enqueue ON':'Auto-enqueue OFF (preview required)'}</button>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs flex items-center gap-1 cursor-pointer"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/> Refresh</button>
        </div>
      </div>
      {msg && <div className="p-2 bg-slate-50 border border-slate-200 rounded text-xs">{msg}</div>}
      {invoices.length===0 ? (
        <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">No QBO invoices awaiting approval. Sync from QuickBooks first, or enable Auto-Enqueue to skip preview.</div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button onClick={approve} disabled={approving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-2 cursor-pointer disabled:opacity-50"><Play className="w-3.5 h-3.5"/> {selected.size ? `Approve Selected (${selected.size})` : `Approve All (${invoices.length})`}</button>
            <span className="text-xs text-slate-500">{invoices.length} pending • DocNumber is source of truth • qboId preserved for writeback</span>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase font-semibold text-slate-500"><tr><th className="p-2"><input type="checkbox" checked={selected.size===invoices.length} onChange={e=> setSelected(e.target.checked? new Set(invoices.map((i:any)=>i.id)): new Set())}/></th><th className="p-2 text-left">Invoice # (DocNumber)</th><th className="p-2">qboId</th><th className="p-2">Date</th><th className="p-2 text-left">Customer</th><th className="p-2">TIN</th><th className="p-2">Lines</th><th className="p-2">Total</th><th className="p-2">Validation</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv:any)=>{
                  const errs = getRowErrors({ clientInvoiceNumber: inv.clientInvoiceNumber||inv.clientInvoiceId, issueDate: inv.issueDate?.substring(0,10)||'', customerCode: inv.customerCode, customerName: inv.customerName, customerTin: inv.customerTin||'', invoiceKind: inv.invoiceKind, itemCode: inv.lineItems?.[0]?.itemCode||'', hsOrServiceCode: inv.lineItems?.[0]?.hsOrServiceCode||'', quantity: inv.lineItems?.[0]?.quantity||1, unitPrice: inv.lineItems?.[0]?.unitPrice||0, vatRate: inv.lineItems?.[0]?.vatRate||0 } as any);
                  return (
                    <tr key={inv.id} className={errs.length? 'bg-amber-50/50':''}>
                      <td className="p-2 text-center"><input type="checkbox" checked={selected.has(inv.id)} onChange={()=>toggle(inv.id)}/></td>
                      <td className="p-2 font-mono font-semibold">{inv.clientInvoiceNumber||inv.clientInvoiceId}</td>
                      <td className="p-2 font-mono text-slate-500">{inv.qboInvoiceId||(inv as any).qbo_invoice_id||'-'}</td>
                      <td className="p-2">{inv.issueDate?.substring(0,10)}</td>
                      <td className="p-2">{inv.customerName} <span className="text-slate-400">({inv.customerCode})</span></td>
                      <td className="p-2 font-mono">{inv.customerTin||'N/A'}</td>
                      <td className="p-2 text-center">{inv.lineItems?.length||0}</td>
                      <td className="p-2 text-right">NGN {Number(inv.totalAmount||inv.grandTotal||0).toLocaleString()}</td>
                      <td className="p-2">{errs.length? <span className="text-amber-700 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{errs[0]}</span> : <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/>OK</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
