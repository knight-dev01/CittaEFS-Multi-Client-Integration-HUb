import { useState } from 'react';
import { useHub } from '../lib/store';
import { 
  Layers, 
  RotateCw, 
  CheckCircle2, 
  AlertOctagon, 
  Play, 
  Trash2, 
  Clock, 
  Activity, 
  Server,
  Zap,
  Filter
} from 'lucide-react';

export function QueueMonitorTab() {
  const { activeTenant, invoices, refreshAll } = useHub();

  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  const [queueJobs, setQueueJobs] = useState([
    {
      id: 'job_bmq_9901',
      invoiceNumber: 'INV-2026-001',
      type: 'CITTA_TRANSMIT',
      tenantId: activeTenant.id,
      attempts: 1,
      maxAttempts: 5,
      status: 'QUEUED',
      backoff: '5s, 30s, 2m, 10m',
      lastError: null,
      scheduledAt: '2026-07-28 10:14:22'
    },
    {
      id: 'job_bmq_9902',
      invoiceNumber: 'INV-2026-002',
      type: 'CITTA_TRANSMIT',
      tenantId: activeTenant.id,
      attempts: 2,
      maxAttempts: 5,
      status: 'PROCESSING',
      backoff: '5s, 30s, 2m, 10m',
      lastError: 'HTTP 503 Gateway Timeout',
      scheduledAt: '2026-07-28 10:12:00'
    },
    {
      id: 'job_bmq_9903',
      invoiceNumber: 'INV-2026-003',
      type: 'LEDGER_WRITEBACK',
      tenantId: activeTenant.id,
      attempts: 1,
      maxAttempts: 5,
      status: 'COMPLETED',
      backoff: '5s',
      lastError: null,
      scheduledAt: '2026-07-28 10:05:10'
    },
    {
      id: 'job_bmq_9904',
      invoiceNumber: 'CN-2026-088',
      type: 'CITTA_TRANSMIT',
      tenantId: activeTenant.id,
      attempts: 5,
      maxAttempts: 5,
      status: 'DLQ',
      backoff: '30m',
      lastError: 'HTTP 502 Bad Gateway after 5 retries. Moved to DLQ.',
      scheduledAt: '2026-07-28 09:40:00'
    }
  ]);

  const handleRunWorker = async () => {
    setIsProcessingBatch(true);
    setTimeout(() => {
      setQueueJobs(queueJobs.map(j => {
        if (j.status === 'QUEUED' || j.status === 'PROCESSING') {
          return { ...j, status: 'COMPLETED', attempts: j.attempts + 1, lastError: null };
        }
        return j;
      }));
      setIsProcessingBatch(false);
      refreshAll();
    }, 1200);
  };

  const handleReplayDLQ = (jobId: string) => {
    setQueueJobs(queueJobs.map(j => {
      if (j.id === jobId) {
        return { ...j, status: 'QUEUED', attempts: 0, lastError: 'Replayed from Dead Letter Queue' };
      }
      return j;
    }));
  };

  const filtered = queueJobs.filter(j => {
    if (filterStatus === 'ALL') return true;
    return j.status === filterStatus;
  });

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            BullMQ Queue Engine & Worker Monitor
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Asynchronous Redis/BullMQ Processing • Exponential Backoff Retry Strategy • Workspace: <strong className="text-white font-medium">{activeTenant.name}</strong>
          </p>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={handleRunWorker}
            disabled={isProcessingBatch}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-2 transition-colors disabled:opacity-50"
          >
            <Zap className="w-4 h-4 text-white" />
            <span>{isProcessingBatch ? 'Executing Worker Batch...' : 'Trigger Worker Batch'}</span>
          </button>
        </div>
      </div>

      {/* Queue Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Queued Jobs</span>
          <span className="text-2xl font-bold text-slate-900 mt-1 block">
            {queueJobs.filter(j => j.status === 'QUEUED').length}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Processing</span>
          <span className="text-2xl font-bold text-indigo-600 mt-1 block">
            {queueJobs.filter(j => j.status === 'PROCESSING').length}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Completed</span>
          <span className="text-2xl font-bold text-emerald-600 mt-1 block">
            {queueJobs.filter(j => j.status === 'COMPLETED').length}
          </span>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block">Dead Letter Queue (DLQ)</span>
          <span className="text-2xl font-bold text-rose-600 mt-1 block">
            {queueJobs.filter(j => j.status === 'DLQ').length}
          </span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-3.5 border border-slate-200/80 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="font-semibold text-slate-700">Filter Queue Jobs:</span>
          {['ALL', 'QUEUED', 'PROCESSING', 'COMPLETED', 'DLQ'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                filterStatus === s ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs font-medium text-slate-500">
          Showing {filtered.length} of {queueJobs.length} Jobs
        </span>
      </div>

      {/* Queue Jobs Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-900">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 font-semibold text-[10px] uppercase tracking-wider border-b border-slate-100">
                <th className="p-3.5 px-4">Job ID</th>
                <th className="p-3.5 px-4">Invoice Ref</th>
                <th className="p-3.5 px-4">Task Type</th>
                <th className="p-3.5 px-4">Attempts</th>
                <th className="p-3.5 px-4">Backoff Policy</th>
                <th className="p-3.5 px-4">Status</th>
                <th className="p-3.5 px-4">Last Error / Note</th>
                <th className="p-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filtered.map((j) => (
                <tr key={j.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="p-3.5 px-4 font-mono font-medium text-slate-500 text-[11px]">{j.id}</td>
                  <td className="p-3.5 px-4 font-mono font-bold text-indigo-600">{j.invoiceNumber}</td>
                  <td className="p-3.5 px-4 font-medium text-slate-700">{j.type}</td>
                  <td className="p-3.5 px-4 font-medium text-slate-600">{j.attempts} / {j.maxAttempts}</td>
                  <td className="p-3.5 px-4 text-slate-500 font-mono text-[11px]">{j.backoff}</td>
                  <td className="p-3.5 px-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                      j.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      j.status === 'PROCESSING' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                      j.status === 'DLQ' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="p-3.5 px-4 text-xs text-rose-600 font-medium max-w-xs truncate">
                    {j.lastError || '—'}
                  </td>
                  <td className="p-3.5 px-4 text-right">
                    {j.status === 'DLQ' ? (
                      <button
                        onClick={() => handleReplayDLQ(j.id)}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
                      >
                        Replay to Queue
                      </button>
                    ) : (
                      <button
                        onClick={() => setQueueJobs(queueJobs.filter(x => x.id !== j.id))}
                        className="text-slate-400 hover:text-rose-600 font-medium text-xs cursor-pointer transition-colors"
                      >
                        Purge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
