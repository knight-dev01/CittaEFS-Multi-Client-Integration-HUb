import { useState } from 'react';
import { useHub } from '../lib/store';
import { 
  RefreshCw, 
  CheckCircle2, 
  Activity, 
  Clock, 
  ShieldCheck, 
  Play, 
  Layers, 
  Cpu, 
  AlertTriangle 
} from 'lucide-react';

export function ReconciliationTab() {
  const { invoices, runReconciliationCron, activeTenant } = useHub();

  const [isRunningCron, setIsRunningCron] = useState(false);
  const [cronResult, setCronResult] = useState<any>(null);

  const pendingCount = invoices.filter(i => i.status === 'PENDING_NRS_STAMP').length;
  const approvedCount = invoices.filter(i => i.status === 'APPROVED' || i.status === 'SIGNED').length;

  const handleRunReconciliation = async () => {
    setIsRunningCron(true);
    setCronResult(null);
    const result = await runReconciliationCron();
    setCronResult(result);
    setIsRunningCron(false);
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-indigo-600 rounded-xl text-white shrink-0 shadow-md shadow-indigo-600/20">
            <RefreshCw className={`w-5 h-5 ${isRunningCron ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Symmetrical Reconciliation & Background Queue Engine
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Poller background workers (<code className="text-indigo-300 font-mono">nrsReconciliationCron</code> & QuickBooks CDC worker) fix dropped webhooks and auto-recover stuck stamps.
            </p>
          </div>
        </div>

        <button
          onClick={handleRunReconciliation}
          disabled={isRunningCron}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-2 transition-colors shrink-0 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isRunningCron ? 'Running Cron Poller...' : 'Execute nrsReconciliationCron'}</span>
        </button>
      </div>

      {/* 3 Workers Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Worker 1 */}
        <div className="bg-white p-5 border border-slate-200/80 rounded-2xl shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-indigo-600" />
              nrsReconciliationCron
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded-full border border-emerald-200">
              HEALTHY / 15-MIN
            </span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Polls CittaEFS Gateway for invoices stuck in <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-mono text-[11px]">PENDING_NRS_STAMP</code> state for &gt;15 minutes to retrieve missing IRNs & QR verification links.
          </p>
          <div className="pt-2 text-[11px] text-slate-500 border-t border-slate-100 flex justify-between font-medium">
            <span>Last Execution:</span>
            <strong className="text-slate-900 font-semibold">Just Now</strong>
          </div>
        </div>

        {/* Worker 2 */}
        <div className="bg-white p-5 border border-slate-200/80 rounded-2xl shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              QuickBooks CDC Worker
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded-full border border-emerald-200">
              ACTIVE
            </span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Queries Change Data Capture (CDC) endpoints to detect and process any missed transactions or dropped webhooks during network disruptions.
          </p>
          <div className="pt-2 text-[11px] text-slate-500 border-t border-slate-100 flex justify-between font-medium">
            <span>CDC Scan Window:</span>
            <strong className="text-slate-900 font-semibold">Every 1 Hour</strong>
          </div>
        </div>

        {/* Worker 3 */}
        <div className="bg-white p-5 border border-slate-200/80 rounded-2xl shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              BullMQ Redis Queue
            </span>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-semibold rounded-full border border-slate-200">
              0 QUEUED
            </span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Buffers incoming invoice calls immediately with exponential backoff retries (5s, 15s, 45s) to guarantee sub-second ERP UI response times.
          </p>
          <div className="pt-2 text-[11px] text-slate-500 border-t border-slate-100 flex justify-between font-medium">
            <span>Max Retry Backoff:</span>
            <strong className="text-slate-900 font-semibold">5 Attempts</strong>
          </div>
        </div>

      </div>

      {/* Cron Result Notice */}
      {cronResult && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white space-y-2 shadow-sm">
          <div className="flex items-center space-x-2 font-bold text-emerald-400 text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span>nrsReconciliationCron Execution Succeeded!</span>
          </div>
          <p className="text-xs text-slate-300">
            {cronResult.message}
          </p>
          <div className="text-[11px] font-mono text-emerald-400 pt-1 font-medium">
            Timestamp: {cronResult.timestamp}
          </div>
        </div>
      )}

      {/* Invoice Ledger Health Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4 shadow-sm">
        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-600" />
          {activeTenant.name} Sync Reconciliation Matrix
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/80">
            <span className="text-xs font-medium text-slate-500">Synchronized & Stamped</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{approvedCount} Invoices</div>
            <p className="text-xs text-slate-500 mt-0.5">IRN assigned & verified on NRS</p>
          </div>

          <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/80">
            <span className="text-xs font-medium text-slate-500">Pending Stamp Recovery</span>
            <div className="text-2xl font-bold text-amber-600 mt-1">{pendingCount} Invoices</div>
            <p className="text-xs text-slate-500 mt-0.5">Targeted by next cron cycle</p>
          </div>

          <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/80">
            <span className="text-xs font-medium text-slate-500">Ledger Writeback Fidelity</span>
            <div className="text-2xl font-bold text-emerald-600 mt-1">100.0%</div>
            <p className="text-xs text-slate-500 mt-0.5">Zero orphan transactions</p>
          </div>
        </div>
      </div>

    </div>
  );
}
