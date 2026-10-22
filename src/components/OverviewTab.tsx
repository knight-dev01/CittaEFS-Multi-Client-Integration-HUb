import { useEffect } from 'react';
import { useHub } from '../lib/store';
import {
  Clock,
  FileText,
  CheckCircle2
} from 'lucide-react';
import { StatusBadge, statusTone } from './ui/StatusBadge';

export function OverviewTab() {
  const { metrics, invoices, activeTenant, refreshAll, isBgRefreshing } = useHub() as any;
  const hasPending = invoices.some((i:any) => ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(i.status));
  const pendingCount = invoices.filter((i:any) => ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(i.status)).length;

  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => { if (document.hidden) return; refreshAll(); }, 5000);
    return () => clearInterval(id);
  }, [hasPending, refreshAll]);

  const totalInvoices = invoices.length;
  const approvedInvoices = invoices.filter((i:any) => i.status === 'APPROVED' || i.status === 'SIGNED').length;
  const queuedInvoices = invoices.filter((i:any) => i.status === 'QUEUED' || i.status === 'PENDING_NRS_STAMP').length;
  const tenantInvoices = activeTenant ? invoices.filter((inv:any) => inv.tenantId === activeTenant.id).slice(0,5) : [];

  if (!activeTenant) {
    return <div className="p-8 text-center text-slate-400 text-xs">No workspace — onboard a client to see overview.</div>;
  }

  return (
    <div className="space-y-6 font-sans text-xs">
      {/* Workspace identity */}
      <div className="bg-white rounded-lg border border-slate-200 px-5 py-3.5 shadow-sm flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold text-slate-900 text-sm">{activeTenant.name} <span className="text-[11px] text-slate-500 font-normal">· {activeTenant.platformType}</span></div>
        <div className="text-[11px] text-slate-500 font-mono">TIN {activeTenant.tin}</div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Ingested Invoices</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{totalInvoices}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">NRS Stamped</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{approvedInvoices}</div>
          <span className="text-xs text-slate-900 font-medium block pt-2 border-t border-slate-100 mt-2">{metrics.nrsStampSuccessRate}% compliance rate</span>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Queue Depth</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{queuedInvoices}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Gateway Latency</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.averageLatencyMs} ms</div>
        </div>
      </div>

      {/* Recent invoices */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><FileText className="w-4 h-4 text-slate-900" /> Recent Invoices {hasPending && <StatusBadge tone="pending"><Clock className={`w-3 h-3 mr-1 ${isBgRefreshing ? 'animate-spin' : 'animate-pulse'}`} /> {pendingCount} pending</StatusBadge>}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Client Inv #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">IRN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {tenantInvoices.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400">No invoices yet — use Invoices tab to send.</td></tr>
              ) : tenantInvoices.map((inv:any) => (
                <tr key={inv.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-semibold text-slate-900">{inv.clientInvoiceNumber}</td>
                  <td className="py-3 px-4 text-slate-900">{inv.customerName}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">NGN {Number(inv.grandTotal ?? inv.totalAmount ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-4"><StatusBadge tone={statusTone(inv.status)}>{inv.status}</StatusBadge></td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600">{inv.irn ? <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-slate-900" />{inv.irn.slice(0,16)}…</span> : <span className="flex items-center gap-1 text-amber-600"><Clock className="w-3 h-3" />Pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
