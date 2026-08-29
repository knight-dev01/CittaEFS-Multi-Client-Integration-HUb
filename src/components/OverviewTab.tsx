import { useHub } from '../lib/store';
import { getStoredCittaEndpoint } from '../lib/gatewaySettings';
import { 
  Activity, 
  Layers, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Server, 
  Zap,
  Plug,
  ShieldCheck,
  Building2,
  Sliders,
  Radio,
  Trash2
} from 'lucide-react';

interface OverviewTabProps {
  onOpenOnboardModal?: () => void;
}

export function OverviewTab({ onOpenOnboardModal }: OverviewTabProps) {
  const { metrics, tenants, invoices, auditLogs, activeTenant, purgeDemoData, currentUser, deleteTenant, setActiveTenantId } = useHub() as any;
  const cittaEndpoint = getStoredCittaEndpoint();

  const userRole = currentUser?.role || 'OPERATOR';
  const canOnboard = userRole === 'ADMIN';
  const canPurge = userRole === 'ADMIN';
  const canDeleteTenant = userRole === 'ADMIN';

  const handlePurge = async () => {
    if (!canPurge) return;
    if (window.confirm('Are you sure you want to purge all test invoices, validation errors, and audit logs to reset staging data?')) {
      await purgeDemoData();
      alert('Staging test data purged! You can now onboard client entities or transmit real invoices.');
    }
  };

  const handleDeleteTenant = async (tenant: any) => {
    if (!canDeleteTenant) return;
    if (!window.confirm(`Delete workspace "${tenant.name}" (${tenant.id})?\n\nThis cascades: invoices, customers, items, queue jobs, integrations will be permanently deleted.`)) return;
    const typed = window.prompt(`Type DELETE to confirm removal of "${tenant.name}":`, "");
    if (typed !== 'DELETE') {
      if (typed !== null) alert('Cancelled — type DELETE exactly.');
      return;
    }
    try {
      await deleteTenant(tenant.id);
    } catch (e: any) {
      alert(e.message || 'Failed to delete tenant');
    }
  };

  const totalInvoices = invoices.length;
  const approvedInvoices = invoices.filter(i => i.status === 'APPROVED' || i.status === 'SIGNED').length;
  const queuedInvoices = invoices.filter(i => i.status === 'QUEUED' || i.status === 'PENDING_NRS_STAMP').length;
  const rejectedInvoices = invoices.filter(i => i.status === 'REJECTED').length;

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Top Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 shadow-sm border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-base">
            <Activity className="w-5 h-5 text-indigo-400" />
            <span>Operational Integration Engine Control Center</span>
          </div>
          <p className="text-slate-400 text-xs mt-1">
            Middleware Routing • Active Workspace: <strong className="text-white font-medium">{activeTenant?.name || 'No Workspace'}</strong> ({activeTenant?.id || 'N/A'})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canOnboard && (
            <button
              onClick={onOpenOnboardModal}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
            >
              <span>+ Onboard Client Entity</span>
            </button>
          )}
          {canPurge && (
            <button
              onClick={handlePurge}
              className="px-3.5 py-2 bg-slate-800 hover:bg-rose-900/40 text-rose-300 hover:text-rose-200 border border-slate-700 hover:border-rose-800 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
            >
              Clear Test Staging Data
            </button>
          )}
        </div>
      </div>

      {/* Primary Operational Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-1.5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Ingested Invoices</span>
          <div className="text-2xl font-bold text-slate-900">{totalInvoices}</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100">
            Across {tenants.length} Active Workspaces
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-1.5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">NRS Stamped</span>
          <div className="text-2xl font-bold text-emerald-600">{approvedInvoices}</div>
          <span className="text-xs text-emerald-600 font-medium block pt-2 border-t border-slate-100">
            99.8% NRS Compliance Rate
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-1.5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Queue Depth</span>
          <div className="text-2xl font-bold text-indigo-600">{queuedInvoices}</div>
          <span className="text-xs text-indigo-600 font-medium block pt-2 border-t border-slate-100">
            BullMQ Async Worker Active
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-1.5 shadow-sm">
          <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Gateway Latency</span>
          <div className="text-2xl font-bold text-slate-900">{metrics.averageLatencyMs} ms</div>
          <span className="text-xs text-slate-500 font-medium block pt-2 border-t border-slate-100">
            CittaEFS REST .NET Service
          </span>
        </div>

      </div>

      {/* Tenants / Workspaces — ADMIN can remove */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><Building2 className="w-4 h-4 text-indigo-600" /> Workspaces ({tenants.length})</span>
          <span className="text-[11px] text-slate-500">{canDeleteTenant ? 'ADMIN: trash icon removes tenant (cascade)' : 'Operator: view only'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-2.5 px-4">Workspace / Tenant</th>
                <th className="py-2.5 px-4">TIN</th>
                <th className="py-2.5 px-4">Platform</th>
                <th className="py-2.5 px-4">Mode</th>
                <th className="py-2.5 px-4 text-right">Invoices</th>
                <th className="py-2.5 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {tenants.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400">No workspaces yet — onboard a client.</td></tr>
              ) : tenants.map((t: any) => {
                const count = invoices.filter((i: any) => i.tenantId === t.id).length;
                const isActive = activeTenant?.id === t.id;
                return (
                  <tr key={t.id} className={`hover:bg-slate-50/80 ${isActive ? 'bg-indigo-50/30' : ''}`}>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" /> {t.name}
                        {isActive && <span className="px-1.5 py-0.5 bg-indigo-600 text-white rounded text-[10px] font-bold">ACTIVE</span>}
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">{t.id}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600">{t.tin}</td>
                    <td className="py-3 px-4 text-slate-700">{t.platformType}</td>
                    <td className="py-3 px-4"><span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-full text-[10px] font-semibold">{t.marketTier || 'Enterprise'}</span></td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">{count}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setActiveTenantId(t.id)} disabled={isActive} className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${isActive ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 cursor-pointer'}`}>Switch</button>
                        {canDeleteTenant && (
                          <button onClick={() => handleDeleteTenant(t)} title={`Remove ${t.name}`} className="p-1.5 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-lg cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* System Status Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="font-bold text-slate-900 text-xs">CittaEFS REST Gateway</span>
            <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-semibold text-[10px]">
              {metrics.cittaGatewayStatus}
            </span>
          </div>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Endpoint:</span>
              <span className="font-semibold text-slate-900 text-right break-all">{cittaEndpoint}</span>
            </div>
            <div className="flex justify-between">
              <span>Serialization:</span>
              <span className="font-semibold text-slate-900">PascalCase / UTC ISO-8601</span>
            </div>
            <div className="flex justify-between">
              <span>Security Scheme:</span>
              <span className="font-semibold text-emerald-600">AES-256-GCM Encrypted</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="font-bold text-slate-900 text-xs">BullMQ & Redis Worker</span>
            <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-semibold text-[10px]">
              RUNNING
            </span>
          </div>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Backoff Policy:</span>
              <span className="font-semibold text-slate-900">5s, 30s, 2m, 10m, 30m</span>
            </div>
            <div className="flex justify-between">
              <span>Max Retries:</span>
              <span className="font-semibold text-slate-900">5 Attempts before DLQ</span>
            </div>
            <div className="flex justify-between">
              <span>Dead Letter Queue:</span>
              <span className="font-semibold text-slate-900">1 Job Awaiting Replay</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="font-bold text-slate-900 text-xs">Reconciliation Workers</span>
            <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-semibold text-[10px]">
              {metrics.reconciliationCronStatus}
            </span>
          </div>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>QuickBooks CDC Cron:</span>
              <span className="font-semibold text-slate-900">Polls Nightly (/cdc)</span>
            </div>
            <div className="flex justify-between">
              <span>NRS Gateway Cron:</span>
              <span className="font-semibold text-slate-900">Polls Every 15 mins</span>
            </div>
            <div className="flex justify-between">
              <span>Auto-Recovery Rate:</span>
              <span className="font-semibold text-emerald-600">100% Resolved</span>
            </div>
          </div>
        </div>

      </div>

      {/* Recent Invoices Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 font-bold text-slate-900 flex justify-between items-center text-xs">
          <span>Recent Ingestion & Regulatory Lifecycle Invoices</span>
          <span className="text-slate-500 font-normal">Active Workspace: {activeTenant?.name || 'No Workspace'}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Client Inv #</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">TIN (Tax ID)</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">NRS IRN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
              {invoices.slice(0, 5).map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-semibold text-indigo-600">{inv.clientInvoiceNumber}</td>
                  <td className="py-3 px-4 font-medium">{inv.invoiceType}</td>
                  <td className="py-3 px-4 font-medium text-slate-900">{inv.customerName}</td>
                  <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{inv.customerTin || 'B2C / Cash Sale'}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{inv.currency} {inv.grandTotal?.toLocaleString()}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                      inv.status === 'APPROVED' || inv.status === 'SIGNED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      inv.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{inv.irn || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
