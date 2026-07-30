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
    <div className="space-y-6 font-mono">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border-2 border-slate-900 p-5 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start space-x-3">
          <div className="p-2.5 bg-amber-400 border border-slate-900 text-slate-950 shrink-0">
            <RefreshCw className={`w-6 h-6 ${isRunningCron ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <h2 className="text-sm font-black text-amber-400 uppercase flex items-center gap-2">
              Symmetrical Reconciliation & Background Queue Engine
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Poller background workers (<code className="text-amber-400 font-mono">nrsReconciliationCron</code> & QuickBooks CDC worker) fix dropped webhooks and auto-recover stuck stamps.
            </p>
          </div>
        </div>

        <button
          onClick={handleRunReconciliation}
          disabled={isRunningCron}
          className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase border-2 border-slate-900 cursor-pointer inline-flex items-center space-x-2 transition shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isRunningCron ? 'Running Cron Poller...' : 'Execute nrsReconciliationCron'}</span>
        </button>
      </div>

      {/* 3 Workers Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Worker 1 */}
        <div className="bg-white p-4 border-2 border-slate-900 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-900 uppercase flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4 text-amber-500" />
              nrsReconciliationCron
            </span>
            <span className="px-2 py-0.5 bg-emerald-400 text-slate-950 text-[10px] font-black border border-slate-900 uppercase">
              HEALTHY / 15-MIN
            </span>
          </div>
          <p className="text-xs text-slate-700">
            Polls CittaEFS Gateway for invoices stuck in <code className="bg-slate-900 text-amber-400 px-1 py-0.5 font-mono">PENDING_NRS_STAMP</code> state for &gt;15 minutes to retrieve missing IRNs & QR verification links.
          </p>
          <div className="pt-2 text-[11px] text-slate-600 border-t-2 border-slate-900 flex justify-between font-bold">
            <span>Last Execution:</span>
            <strong className="text-slate-900 font-black">Just Now</strong>
          </div>
        </div>

        {/* Worker 2 */}
        <div className="bg-white p-4 border-2 border-slate-900 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-900 uppercase flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-amber-500" />
              QuickBooks CDC Worker
            </span>
            <span className="px-2 py-0.5 bg-emerald-400 text-slate-950 text-[10px] font-black border border-slate-900 uppercase">
              ACTIVE
            </span>
          </div>
          <p className="text-xs text-slate-700">
            Queries Change Data Capture (CDC) endpoints to detect and process any missed transactions or dropped webhooks during network disruptions.
          </p>
          <div className="pt-2 text-[11px] text-slate-600 border-t-2 border-slate-900 flex justify-between font-bold">
            <span>CDC Scan Window:</span>
            <strong className="text-slate-900 font-black">Every 1 Hour</strong>
          </div>
        </div>

        {/* Worker 3 */}
        <div className="bg-white p-4 border-2 border-slate-900 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-900 uppercase flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-amber-500" />
              BullMQ Redis Queue
            </span>
            <span className="px-2 py-0.5 bg-slate-900 text-amber-400 text-[10px] font-black border border-slate-900 uppercase">
              0 QUEUED
            </span>
          </div>
          <p className="text-xs text-slate-700">
            Buffers incoming invoice calls immediately with exponential backoff retries (5s, 15s, 45s) to guarantee sub-second ERP UI response times.
          </p>
          <div className="pt-2 text-[11px] text-slate-600 border-t-2 border-slate-900 flex justify-between font-bold">
            <span>Max Retry Backoff:</span>
            <strong className="text-slate-900 font-black">5 Attempts</strong>
          </div>
        </div>

      </div>

      {/* Cron Result Notice */}
      {cronResult && (
        <div className="bg-slate-900 border-2 border-slate-900 p-4 text-white space-y-2">
          <div className="flex items-center space-x-2 font-black text-amber-400 text-sm uppercase">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span>nrsReconciliationCron Execution Succeeded!</span>
          </div>
          <p className="text-xs text-slate-200">
            {cronResult.message}
          </p>
          <div className="text-[11px] font-mono text-emerald-400 pt-1 font-bold">
            Timestamp: {cronResult.timestamp}
          </div>
        </div>
      )}

      {/* Invoice Ledger Health Table */}
      <div className="bg-white border-2 border-slate-900 p-5 space-y-3">
        <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-500" />
          {activeTenant.name} Sync Reconciliation Matrix
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-slate-100 border-2 border-slate-900">
            <span className="text-[10px] font-black text-slate-900 uppercase">Synchronized & Stamped</span>
            <div className="text-xl font-black text-slate-900 mt-1">{approvedCount} Invoices</div>
            <p className="text-[11px] text-slate-600 font-bold mt-0.5">IRN assigned & verified on NRS</p>
          </div>

          <div className="p-3 bg-slate-100 border-2 border-slate-900">
            <span className="text-[10px] font-black text-slate-900 uppercase">Pending Stamp Recovery</span>
            <div className="text-xl font-black text-slate-900 mt-1">{pendingCount} Invoices</div>
            <p className="text-[11px] text-slate-600 font-bold mt-0.5">Targeted by next cron cycle</p>
          </div>

          <div className="p-3 bg-slate-100 border-2 border-slate-900">
            <span className="text-[10px] font-black text-slate-900 uppercase">Ledger Writeback Fidelity</span>
            <div className="text-xl font-black text-slate-900 mt-1">100.0%</div>
            <p className="text-[11px] text-slate-600 font-bold mt-0.5">Zero orphan transactions</p>
          </div>
        </div>
      </div>

    </div>
  );
}
