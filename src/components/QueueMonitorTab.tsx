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
    <div className="space-y-6 font-mono text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-4 border-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-amber-400 uppercase flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-400" />
            BullMQ Queue Engine & Worker Monitor
          </h2>
          <p className="text-slate-300 text-xs mt-1">
            Asynchronous Redis/BullMQ Processing • Exponential Backoff Retry Strategy • Tenant: <strong className="text-white">{activeTenant.name}</strong>
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRunWorker}
            disabled={isProcessingBatch}
            className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black uppercase border-2 border-slate-900 cursor-pointer inline-flex items-center space-x-1.5"
          >
            <Zap className="w-4 h-4 text-slate-950" />
            <span>{isProcessingBatch ? 'Executing Worker Batch...' : 'Trigger Worker Batch'}</span>
          </button>
        </div>
      </div>

      {/* Queue Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border-2 border-slate-900 p-3">
          <span className="text-[10px] text-slate-500 font-black uppercase block">Queued Jobs</span>
          <span className="text-xl font-black text-slate-900">
            {queueJobs.filter(j => j.status === 'QUEUED').length}
          </span>
        </div>
        <div className="bg-white border-2 border-slate-900 p-3">
          <span className="text-[10px] text-slate-500 font-black uppercase block">Processing</span>
          <span className="text-xl font-black text-indigo-700">
            {queueJobs.filter(j => j.status === 'PROCESSING').length}
          </span>
        </div>
        <div className="bg-white border-2 border-slate-900 p-3">
          <span className="text-[10px] text-slate-500 font-black uppercase block">Completed</span>
          <span className="text-xl font-black text-emerald-700">
            {queueJobs.filter(j => j.status === 'COMPLETED').length}
          </span>
        </div>
        <div className="bg-white border-2 border-slate-900 p-3">
          <span className="text-[10px] text-slate-500 font-black uppercase block">Dead Letter Queue (DLQ)</span>
          <span className="text-xl font-black text-red-600">
            {queueJobs.filter(j => j.status === 'DLQ').length}
          </span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-slate-100 p-3 border-2 border-slate-900 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-900" />
          <span className="font-black text-slate-900 uppercase">Filter Queue Jobs:</span>
          {['ALL', 'QUEUED', 'PROCESSING', 'COMPLETED', 'DLQ'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 text-[10px] font-black uppercase border border-slate-900 cursor-pointer ${
                filterStatus === s ? 'bg-slate-900 text-amber-400' : 'bg-white text-slate-900'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-bold text-slate-600">
          Showing {filtered.length} of {queueJobs.length} Jobs
        </span>
      </div>

      {/* Queue Jobs Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-amber-400 font-black uppercase text-[10px] border-b-2 border-slate-900">
                <th className="p-3">Job ID</th>
                <th className="p-3">Invoice Ref</th>
                <th className="p-3">Task Type</th>
                <th className="p-3">Attempts</th>
                <th className="p-3">Backoff Policy</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last Error / Note</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-100 font-mono text-slate-900">
              {filtered.map((j) => (
                <tr key={j.id} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-600">{j.id}</td>
                  <td className="p-3 font-black text-indigo-700">{j.invoiceNumber}</td>
                  <td className="p-3 font-bold">{j.type}</td>
                  <td className="p-3 font-bold">{j.attempts} / {j.maxAttempts}</td>
                  <td className="p-3 text-slate-600">{j.backoff}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 border border-slate-900 text-[10px] font-black uppercase ${
                      j.status === 'COMPLETED' ? 'bg-emerald-300 text-slate-950' :
                      j.status === 'PROCESSING' ? 'bg-indigo-300 text-slate-950' :
                      j.status === 'DLQ' ? 'bg-red-400 text-slate-950' : 'bg-amber-300 text-slate-950'
                    }`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="p-3 text-[11px] text-red-600 font-bold max-w-xs truncate">
                    {j.lastError || '—'}
                  </td>
                  <td className="p-3 text-right">
                    {j.status === 'DLQ' ? (
                      <button
                        onClick={() => handleReplayDLQ(j.id)}
                        className="px-2 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-black border border-slate-900 cursor-pointer uppercase"
                      >
                        Replay to Queue
                      </button>
                    ) : (
                      <button
                        onClick={() => setQueueJobs(queueJobs.filter(x => x.id !== j.id))}
                        className="text-slate-500 hover:text-slate-900 font-bold uppercase cursor-pointer"
                      >
                        [Purge]
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
