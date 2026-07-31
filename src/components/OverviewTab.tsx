import { useHub } from '../lib/store';
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
  Radio
} from 'lucide-react';

interface OverviewTabProps {
  onOpenOnboardModal?: () => void;
}

export function OverviewTab({ onOpenOnboardModal }: OverviewTabProps) {
  const { metrics, tenants, invoices, auditLogs, activeTenant, purgeDemoData, currentUser } = useHub();

  const userRole = currentUser?.role || 'OPERATOR';
  const canOnboard = userRole === 'ADMIN';
  const canPurge = userRole === 'ADMIN';

  const handlePurge = async () => {
    if (!canPurge) return;
    if (window.confirm('Are you sure you want to purge all test invoices, validation errors, and audit logs to reset staging data?')) {
      await purgeDemoData();
      alert('Staging test data purged! You can now onboard client entities or transmit real invoices.');
    }
  };

  const totalInvoices = invoices.length;
  const approvedInvoices = invoices.filter(i => i.status === 'APPROVED' || i.status === 'SIGNED').length;
  const queuedInvoices = invoices.filter(i => i.status === 'QUEUED' || i.status === 'PENDING_NRS_STAMP').length;
  const rejectedInvoices = invoices.filter(i => i.status === 'REJECTED').length;

  return (
    <div className="space-y-6 font-mono text-xs">
      
      {/* Top Banner */}
      <div className="bg-slate-900 text-white p-4 border-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 font-black text-base uppercase">
            <Activity className="w-5 h-5 text-amber-400" />
            <span>Operational Integration Engine Control Center</span>
          </div>
          <p className="text-slate-300 text-xs mt-0.5">
            Middleware Routing • Active Tenant: <strong className="text-white">{activeTenant.name}</strong> ({activeTenant.id})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canOnboard && (
            <button
              onClick={onOpenOnboardModal}
              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black uppercase border-2 border-slate-900 cursor-pointer"
            >
              + Onboard Client Entity
            </button>
          )}
          {canPurge && (
            <button
              onClick={handlePurge}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-black uppercase border-2 border-slate-900 cursor-pointer"
            >
              Clear Test Staging Data
            </button>
          )}
        </div>
      </div>

      {/* Primary Operational Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        <div className="bg-white border-2 border-slate-900 p-4 space-y-1">
          <span className="text-[10px] text-slate-500 font-black uppercase block">Ingested Invoices</span>
          <div className="text-2xl font-black text-slate-900">{totalInvoices}</div>
          <span className="text-[10px] text-slate-600 font-bold block pt-1 border-t border-slate-100">
            Across {tenants.length} Active Tenants
          </span>
        </div>

        <div className="bg-white border-2 border-slate-900 p-4 space-y-1">
          <span className="text-[10px] text-slate-500 font-black uppercase block">NRS Gateway Stamped</span>
          <div className="text-2xl font-black text-emerald-700">{approvedInvoices}</div>
          <span className="text-[10px] text-emerald-800 font-bold block pt-1 border-t border-slate-100">
            99.8% NRS Compliance Rate
          </span>
        </div>

        <div className="bg-white border-2 border-slate-900 p-4 space-y-1">
          <span className="text-[10px] text-slate-500 font-black uppercase block">Queue Depth</span>
          <div className="text-2xl font-black text-indigo-700">{queuedInvoices}</div>
          <span className="text-[10px] text-indigo-800 font-bold block pt-1 border-t border-slate-100">
            BullMQ Async Worker Active
          </span>
        </div>

        <div className="bg-white border-2 border-slate-900 p-4 space-y-1">
          <span className="text-[10px] text-slate-500 font-black uppercase block">Gateway Latency</span>
          <div className="text-2xl font-black text-slate-900">{metrics.averageLatencyMs} ms</div>
          <span className="text-[10px] text-slate-600 font-bold block pt-1 border-t border-slate-100">
            CittaEFS REST .NET Service
          </span>
        </div>

      </div>

      {/* System Status Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        <div className="bg-white border-2 border-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
            <span className="font-black text-slate-900 uppercase">CittaEFS REST Gateway</span>
            <span className="px-2 py-0.5 bg-emerald-300 text-slate-950 border border-slate-900 font-black uppercase text-[10px]">
              {metrics.cittaGatewayStatus}
            </span>
          </div>
          <div className="space-y-1.5 text-[11px] text-slate-700">
            <div className="flex justify-between">
              <span>Endpoint:</span>
              <span className="font-bold text-slate-900">gateway.cittaefs.com/api/v1</span>
            </div>
            <div className="flex justify-between">
              <span>Serialization:</span>
              <span className="font-bold text-slate-900">PascalCase / UTC ISO-8601</span>
            </div>
            <div className="flex justify-between">
              <span>Security Scheme:</span>
              <span className="font-bold text-emerald-700">AES-256-GCM Encrypted</span>
            </div>
          </div>
        </div>

        <div className="bg-white border-2 border-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
            <span className="font-black text-slate-900 uppercase">BullMQ & Redis Worker</span>
            <span className="px-2 py-0.5 bg-emerald-300 text-slate-950 border border-slate-900 font-black uppercase text-[10px]">
              RUNNING
            </span>
          </div>
          <div className="space-y-1.5 text-[11px] text-slate-700">
            <div className="flex justify-between">
              <span>Backoff Policy:</span>
              <span className="font-bold text-slate-900">5s, 30s, 2m, 10m, 30m</span>
            </div>
            <div className="flex justify-between">
              <span>Max Retries:</span>
              <span className="font-bold text-slate-900">5 Attempts before DLQ</span>
            </div>
            <div className="flex justify-between">
              <span>Dead Letter Queue:</span>
              <span className="font-bold text-slate-900">1 Job Awaiting Replay</span>
            </div>
          </div>
        </div>

        <div className="bg-white border-2 border-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
            <span className="font-black text-slate-900 uppercase">Reconciliation Workers</span>
            <span className="px-2 py-0.5 bg-emerald-300 text-slate-950 border border-slate-900 font-black uppercase text-[10px]">
              {metrics.reconciliationCronStatus}
            </span>
          </div>
          <div className="space-y-1.5 text-[11px] text-slate-700">
            <div className="flex justify-between">
              <span>QuickBooks CDC Cron:</span>
              <span className="font-bold text-slate-900">Polls Nightly (/cdc)</span>
            </div>
            <div className="flex justify-between">
              <span>NRS Gateway Cron:</span>
              <span className="font-bold text-slate-900">Polls Every 15 mins</span>
            </div>
            <div className="flex justify-between">
              <span>Auto-Recovery Rate:</span>
              <span className="font-bold text-emerald-700">100% Resolved</span>
            </div>
          </div>
        </div>

      </div>

      {/* Recent Invoices Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        <div className="p-3 bg-slate-100 border-b-2 border-slate-900 font-black uppercase text-slate-900 flex justify-between items-center">
          <span>Recent Ingestion & Regulatory Lifecycle Invoices</span>
          <span className="text-[10px] text-slate-600 font-normal">Active Tenant: {activeTenant.name}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-amber-400 font-black uppercase text-[10px] border-b-2 border-slate-900">
                <th className="p-3">Client Inv #</th>
                <th className="p-3">Type</th>
                <th className="p-3">Customer</th>
                <th className="p-3">TIN (Tax ID)</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">NRS IRN</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-100 font-mono text-slate-900">
              {invoices.slice(0, 5).map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-indigo-700">{inv.clientInvoiceNumber}</td>
                  <td className="p-3 font-bold">{inv.invoiceType}</td>
                  <td className="p-3 font-bold">{inv.customerName}</td>
                  <td className="p-3 font-mono font-bold text-slate-700">{inv.customerTin || 'B2C / Cash Sale'}</td>
                  <td className="p-3 font-bold">{inv.currency} {inv.grandTotal?.toLocaleString()}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 border border-slate-900 text-[10px] font-black uppercase ${
                      inv.status === 'APPROVED' || inv.status === 'SIGNED' ? 'bg-emerald-300 text-slate-950' :
                      inv.status === 'REJECTED' ? 'bg-red-400 text-slate-950' : 'bg-amber-300 text-slate-950'
                    }`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-slate-800">{inv.irn || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
