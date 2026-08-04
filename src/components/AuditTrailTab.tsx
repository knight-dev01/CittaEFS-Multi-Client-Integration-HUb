import { useState } from 'react';
import { useHub } from '../lib/store';
import { AuditLog } from '../types';
import { 
  ShieldCheck, 
  Search, 
  FileCode, 
  Lock, 
  Terminal, 
  Key,
  CheckCircle2,
  Filter,
  X
} from 'lucide-react';

export function AuditTrailTab() {
  const { auditLogs, activeTenant } = useHub();

  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLog | null>(null);

  const tenantAuditLogs = auditLogs.filter(a => a.tenantId === activeTenant.id);

  const filteredLogs = tenantAuditLogs.filter(log => {
    const matchesSearch = 
      log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.entityRef.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.sha256PayloadHash.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;

    return matchesSearch && matchesAction;
  });

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-indigo-600 rounded-xl text-white shrink-0 shadow-md shadow-indigo-600/20">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Immutable Tax Audit Trail (<code className="text-indigo-300 font-mono text-xs">TaxAuditLog</code>)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Append-only audit log recording every gateway transmission, modification, and response with SHA-256 cryptographic hashes.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs shrink-0">
          <span className="px-3 py-1 bg-indigo-500/10 text-indigo-300 font-medium rounded-full border border-indigo-500/20">
            SHA-256 Enabled
          </span>
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 font-medium rounded-full border border-emerald-500/20">
            Audit Prepared
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search details, entity ref, or SHA-256 hash..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200/80 rounded-lg bg-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-700">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="font-medium">Action Type:</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-white border border-slate-200/80 rounded-lg px-3 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer transition-all"
          >
            <option value="ALL">All Actions</option>
            <option value="CITTA_SUBMITTED">CITTA_SUBMITTED</option>
            <option value="WEBHOOK_RECEIVED">WEBHOOK_RECEIVED</option>
            <option value="INVOICE_INGESTED">INVOICE_INGESTED</option>
            <option value="RECONCILIATION_RUN">RECONCILIATION_RUN</option>
          </select>
        </div>

      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-900">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Action Type</th>
                <th className="py-3 px-4">Entity Ref</th>
                <th className="py-3 px-4">Transaction Details</th>
                <th className="py-3 px-4 font-mono">SHA-256 Payload Hash</th>
                <th className="py-3 px-4">Executed By</th>
                <th className="py-3 px-4 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500 font-medium">
                    No audit log records match your filter query.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 font-medium whitespace-nowrap">
                      {log.timestamp}
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200/80">
                        {log.action}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {log.entityRef}
                    </td>

                    <td className="py-3.5 px-4 max-w-sm leading-relaxed text-slate-600 font-medium" title={log.details}>
                      {log.details}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-700 font-semibold select-all">
                      {log.sha256PayloadHash.substring(0, 24)}...
                    </td>

                    <td className="py-3.5 px-4 text-xs text-slate-600 font-medium">
                      {log.performedBy}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      {log.rawJson ? (
                        <button
                          onClick={() => setSelectedAuditLog(log)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center"
                          title="Inspect Cryptographic Payload"
                        >
                          <FileCode className="w-4 h-4 text-indigo-600" />
                        </button>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">N/A</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* INSPECT AUDIT LOG PAYLOAD MODAL */}
      {selectedAuditLog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 text-white space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-400" />
                Audit Record SHA-256 Payload Inspector ({selectedAuditLog.entityRef})
              </h3>
              <button
                onClick={() => setSelectedAuditLog(null)}
                className="text-slate-400 hover:text-white cursor-pointer font-medium p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1.5 bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 font-mono">
              <p>Action: <strong className="text-indigo-400">{selectedAuditLog.action}</strong></p>
              <p>Executed By: <strong className="text-white">{selectedAuditLog.performedBy}</strong></p>
              <p>Cryptographic Signature:</p>
              <p className="text-emerald-400 font-semibold break-all text-[11px]">{selectedAuditLog.sha256PayloadHash}</p>
            </div>

            <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-80">
              {JSON.stringify(selectedAuditLog.rawJson, null, 2)}
            </pre>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedAuditLog(null)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
              >
                Done Inspecting
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
