import { useEffect } from 'react';
import { useHub } from '../lib/store';
import {
  Activity,
  CheckCircle2,
  Clock,
  FileText,
  ChevronDown
} from 'lucide-react';
import { StatusBadge, statusTone } from './ui/StatusBadge';

interface OverviewTabProps {
  onOpenOnboardModal?: () => void;
}

export function OverviewTab({ onOpenOnboardModal }: OverviewTabProps) {
  const { metrics, tenants, invoices, activeTenant, currentUser, refreshAll, isBgRefreshing } = useHub() as any;
  const cittaEndpoint = (activeTenant?.cittaGatewayUrl?.trim() || 'https://ei-api.azurewebsites.net');
  const hasPending = invoices.some((i:any) => ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(i.status));
  const pendingCount = invoices.filter((i:any) => ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(i.status)).length;

  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => { if (document.hidden) return; refreshAll(); }, 5000);
    return () => clearInterval(id);
  }, [hasPending, refreshAll]);

  const userRole = currentUser?.role || 'OPERATOR';
  const canOnboard = userRole === 'ADMIN';

  const totalInvoices = invoices.length;
  const approvedInvoices = invoices.filter((i:any) => i.status === 'APPROVED' || i.status === 'SIGNED').length;
  const queuedInvoices = invoices.filter((i:any) => i.status === 'QUEUED' || i.status === 'PENDING_NRS_STAMP').length;
  const tenantInvoices = activeTenant ? invoices.filter((inv:any) => inv.tenantId === activeTenant.id).slice(0,5) : [];

  if (!activeTenant) {
    return <div className="p-8 text-center text-slate-400 text-xs">No workspace — onboard a client to see overview.</div>;
  }

  return (
    <div className="space-y-6 font-sans text-xs">
      {/* Top banner — overview */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div>
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider flex items-center gap-2"><Activity className="w-4 h-4 text-slate-900" /> Overview</span>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-9 h-9 rounded-full bg-slate-600 text-white flex items-center justify-center font-bold text-xs">
              {(activeTenant.name || 'CN').slice(0,2).toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">{activeTenant.name} <span className="text-[11px] text-slate-500 font-normal">• {activeTenant.platformType}</span></div>
              <div className="text-[11px] text-slate-500 font-mono">TIN: {activeTenant.tin} • {activeTenant.companyName}</div>
            </div>
          </div>
        </div>
        {canOnboard && (
          <button onClick={onOpenOnboardModal} className="px-3.5 py-2 bg-slate-600 hover:bg-slate-700 text-white font-semibold text-xs rounded-lg cursor-pointer">+ Onboard ERP</button>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Ingested Invoices</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{totalInvoices}</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100 mt-2">Across {tenants.length} workspaces</span>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">NRS Stamped</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{approvedInvoices}</div>
          <span className="text-xs text-slate-900 font-medium block pt-2 border-t border-slate-100 mt-2">{metrics.nrsStampSuccessRate}% compliance rate</span>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Queue Depth</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{queuedInvoices}</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100 mt-2">Awaiting transmission</span>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Gateway Latency</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.averageLatencyMs} ms</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100 mt-2">CittaEFS REST</span>
        </div>
      </div>

      {/* System status — collapsed by default */}
      <details className="group">
        <summary className="list-none cursor-pointer">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
            <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><Activity className="w-4 h-4 text-slate-900" /> System Status</span>
            <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition" />
          </div>
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="font-bold text-slate-900 text-xs">CittaEFS Gateway</span><span className="px-2.5 py-0.5 bg-slate-50 text-slate-900 border border-slate-200 rounded-full font-semibold text-[10px]">{metrics.cittaGatewayStatus}</span></div>
            <div className="space-y-2 text-xs text-slate-600 mt-3">
              <div className="flex justify-between gap-3"><span className="shrink-0">Endpoint:</span><span className="font-mono font-semibold text-slate-900 break-all text-right">{cittaEndpoint}</span></div>
              <div className="flex justify-between"><span>Security:</span><span className="font-semibold text-slate-900">AES-256-GCM</span></div>
              <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">Shared key: all tenants use <span className="font-mono text-slate-900">CITTAEFS_API_KEY</span> → {cittaEndpoint}/api/integration/gen/invoices</div>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="font-bold text-slate-900 text-xs">Worker</span><span className="px-2.5 py-0.5 bg-slate-50 text-slate-900 border border-slate-200 rounded-full font-semibold text-[10px]">RUNNING</span></div>
            <div className="space-y-2 text-xs text-slate-600 mt-3">
              <div className="flex justify-between"><span>Backoff:</span><span className="font-semibold text-slate-900">5s,30s,2m,10m</span></div>
              <div className="flex justify-between"><span>Max Retries:</span><span className="font-semibold text-slate-900">5</span></div>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="font-bold text-slate-900 text-xs">Reconciliation</span><span className="px-2.5 py-0.5 bg-slate-50 text-slate-900 border border-slate-200 rounded-full font-semibold text-[10px]">{metrics.reconciliationCronStatus}</span></div>
            <div className="space-y-2 text-xs text-slate-600 mt-3">
              <div className="flex justify-between"><span>NRS Cron:</span><span className="font-semibold text-slate-900">Every 15m</span></div>
            </div>
          </div>
        </div>
      </details>

      {/* Recent invoices */}
      <div className={`bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm ${hasPending ? 'ring-1 ring-slate-200' : ''}`}>
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><FileText className="w-4 h-4 text-slate-900" /> Recent Invoices {hasPending && <StatusBadge tone="pending"><Clock className={`w-3 h-3 mr-1 ${isBgRefreshing ? 'animate-spin' : 'animate-pulse'}`} /> Live tracking {pendingCount} pending</StatusBadge>} {isBgRefreshing && !hasPending && <span className="w-2 h-2 bg-slate-600 rounded-full animate-pulse" />}</span>
          <span className="text-[11px] text-slate-500">Active: {activeTenant.name} • {hasPending ? '5s poll + WS • Send from Invoices tab' : 'Send from Invoices tab'}</span>
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
