import { useHub } from '../lib/store';
import { 
  Activity,
  CheckCircle2,
  Clock,
  Building2,
  Trash2,
  FileText
} from 'lucide-react';

interface OverviewTabProps {
  onOpenOnboardModal?: () => void;
}

export function OverviewTab({ onOpenOnboardModal }: OverviewTabProps) {
  const { metrics, tenants, invoices, activeTenant, purgeDemoData, currentUser, deleteTenant, setActiveTenantId } = useHub() as any;
  const cittaEndpoint = (activeTenant?.cittaGatewayUrl?.trim() || 'https://ei-api.azurewebsites.net');

  const userRole = currentUser?.role || 'OPERATOR';
  const canOnboard = userRole === 'ADMIN';
  const canPurge = userRole === 'ADMIN';
  const canDeleteTenant = userRole === 'ADMIN';

  const handlePurge = async () => {
    if (!canPurge) return;
    if (!window.confirm('Purge test invoices, validation errors and audit logs? This cannot be undone.')) return;
    try { await purgeDemoData(); } catch {}
  };

  const handleDeleteTenant = async (tenant: any) => {
    if (!canDeleteTenant) return;
    if (!window.confirm(`Delete workspace "${tenant.name}" (${tenant.id})? Cascades all data.`)) return;
    const typed = window.prompt(`Type DELETE to confirm removal of "${tenant.name}":`, "");
    if (typed !== 'DELETE') return;
    try { await deleteTenant(tenant.id); } catch {}
  };

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
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div>
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider flex items-center gap-2"><Activity className="w-4 h-4 text-violet-600" /> Overview</span>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-9 h-9 rounded-full bg-violet-600 text-white flex items-center justify-center font-bold text-xs">
              {(activeTenant.name || 'CN').slice(0,2).toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">{activeTenant.name} <span className="text-[11px] text-slate-500 font-normal">• {activeTenant.platformType}</span></div>
              <div className="text-[11px] text-slate-500 font-mono">TIN: {activeTenant.tin} • {activeTenant.companyName}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canOnboard && (
            <button onClick={onOpenOnboardModal} className="px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs rounded-lg cursor-pointer">+ Onboard Client</button>
          )}
          {canPurge && (
            <button onClick={handlePurge} className="px-3 py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer">Clear Staging</button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Ingested Invoices</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{totalInvoices}</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100 mt-2">Across {tenants.length} workspaces</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">NRS Stamped</span>
          <div className="text-2xl font-bold text-violet-600 mt-1">{approvedInvoices}</div>
          <span className="text-xs text-violet-600 font-medium block pt-2 border-t border-slate-100 mt-2">Compliance Rate</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Queue Depth</span>
          <div className="text-2xl font-bold text-violet-600 mt-1">{queuedInvoices}</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100 mt-2">Worker Active</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Gateway Latency</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.averageLatencyMs} ms</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100 mt-2">CittaEFS REST</span>
        </div>
      </div>

      {/* Workspaces overview */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><Building2 className="w-4 h-4 text-violet-600" /> Workspaces ({tenants.length})</span>
          <span className="text-[11px] text-slate-500">{canDeleteTenant ? 'ADMIN: trash removes tenant' : 'View only'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-2.5 px-4">Workspace</th>
                <th className="py-2.5 px-4">TIN</th>
                <th className="py-2.5 px-4">Platform</th>
                <th className="py-2.5 px-4 text-right">Invoices</th>
                <th className="py-2.5 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {tenants.map((t:any) => {
                const count = invoices.filter((i:any) => i.tenantId === t.id).length;
                const isActive = activeTenant?.id === t.id;
                return (
                  <tr key={t.id} className={`hover:bg-violet-50/30 ${isActive ? 'bg-violet-50/40' : ''}`}>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 flex items-center gap-2"><Building2 className="w-3.5 h-3.5 text-slate-400" /> {t.name} {isActive && <span className="px-1.5 py-0.5 bg-violet-600 text-white rounded text-[10px] font-bold">ACTIVE</span>}</div>
                      <span className="font-mono text-[11px] text-slate-500">{t.id}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">{t.tin}</td>
                    <td className="py-3 px-4 text-slate-700">{t.platformType}</td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">{count}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setActiveTenantId(t.id)} disabled={isActive} className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${isActive ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white hover:bg-violet-50 text-slate-700 border-slate-200 cursor-pointer'}`}>Switch</button>
                        {canDeleteTenant && <button onClick={() => handleDeleteTenant(t)} className="p-1.5 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* System status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="font-bold text-slate-900 text-xs">CittaEFS Gateway</span><span className="px-2.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-full font-semibold text-[10px]">{metrics.cittaGatewayStatus}</span></div>
          <div className="space-y-2 text-xs text-slate-600 mt-3">
            <div className="flex justify-between gap-3"><span className="shrink-0">Endpoint:</span><span className="font-mono font-semibold text-violet-700 break-all text-right">{cittaEndpoint}</span></div>
            <div className="flex justify-between"><span>Security:</span><span className="font-semibold text-violet-600">AES-256-GCM</span></div>
            <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">Shared key: all tenants use <span className="font-mono text-violet-600">CITTAEFS_API_KEY</span> → {cittaEndpoint}/api/integration/gen/invoices</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="font-bold text-slate-900 text-xs">Worker</span><span className="px-2.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-full font-semibold text-[10px]">RUNNING</span></div>
          <div className="space-y-2 text-xs text-slate-600 mt-3">
            <div className="flex justify-between"><span>Backoff:</span><span className="font-semibold text-slate-900">5s,30s,2m,10m</span></div>
            <div className="flex justify-between"><span>Max Retries:</span><span className="font-semibold text-slate-900">5</span></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="font-bold text-slate-900 text-xs">Reconciliation</span><span className="px-2.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-full font-semibold text-[10px]">{metrics.reconciliationCronStatus}</span></div>
          <div className="space-y-2 text-xs text-slate-600 mt-3">
            <div className="flex justify-between"><span>NRS Cron:</span><span className="font-semibold text-slate-900">Every 15m</span></div>
            <div className="flex justify-between"><span>Recovery:</span><span className="font-semibold text-violet-600">100%</span></div>
          </div>
        </div>
      </div>

      {/* Recent invoices — overview only (no Send) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><FileText className="w-4 h-4 text-violet-600" /> Recent Invoices — Overview</span>
          <span className="text-[11px] text-slate-500">Active: {activeTenant.name} • Send from Invoices tab</span>
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
                  <td className="py-3 px-4 font-semibold text-violet-700">{inv.clientInvoiceNumber}</td>
                  <td className="py-3 px-4 text-slate-900">{inv.customerName}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">NGN {Number(inv.grandTotal ?? inv.totalAmount ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-4"><span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${inv.status==='APPROVED'||inv.status==='SIGNED' ? 'bg-violet-600 text-white' : inv.status==='REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>{inv.status}</span></td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600">{inv.irn ? <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-violet-600" />{inv.irn.slice(0,16)}…</span> : <span className="flex items-center gap-1 text-amber-600"><Clock className="w-3 h-3" />Pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
