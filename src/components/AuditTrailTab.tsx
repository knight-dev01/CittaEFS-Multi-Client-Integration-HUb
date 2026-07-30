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
  Filter
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
    <div className="space-y-6 font-mono">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-5 border-2 border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start space-x-3">
          <div className="p-2.5 bg-amber-400 border border-slate-900 text-slate-950 shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-amber-400 uppercase flex items-center gap-2">
              Immutable Tax Audit Trail (<code className="text-amber-400 font-mono">TaxAuditLog</code>)
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Append-only audit log recording every gateway transmission, modification, and response with SHA-256 cryptographic hashes.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <span className="px-3 py-1 bg-amber-400 text-slate-950 font-black border border-slate-900 uppercase">
            SHA-256 Enabled
          </span>
          <span className="px-3 py-1 bg-emerald-400 text-slate-950 font-black border border-slate-900 uppercase">
            Audit Prepared
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-900 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="SEARCH DETAILS, ENTITY REF, OR SHA-256 HASH..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border-2 border-slate-900 bg-white font-bold focus:outline-none uppercase text-slate-900"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-900">
          <Filter className="w-3.5 h-3.5 text-slate-900" />
          <span className="font-black uppercase">Action Type:</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-white border-2 border-slate-900 px-2.5 py-1.5 text-xs text-slate-900 font-black uppercase focus:outline-none cursor-pointer"
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
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-900">
            <thead>
              <tr className="bg-slate-100 text-slate-900 uppercase text-[10px] tracking-wider border-b-2 border-slate-900">
                <th className="py-2.5 px-3 border-r border-slate-300">Timestamp</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Action Type</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Entity Ref</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Transaction Details</th>
                <th className="py-2.5 px-3 border-r border-slate-300 font-mono">SHA-256 Payload Hash</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Executed By</th>
                <th className="py-2.5 px-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-900 font-black uppercase">
                    No audit log records match your filter query.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-100 transition">
                    <td className="py-3 px-3 font-mono text-[10px] text-slate-700 font-bold whitespace-nowrap border-r border-slate-200">
                      {log.timestamp}
                    </td>

                    <td className="py-3 px-3 border-r border-slate-200">
                      <span className="px-2 py-0.5 text-[10px] font-black bg-slate-900 text-amber-400 border border-slate-900 uppercase">
                        {log.action}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-mono font-black text-slate-900 border-r border-slate-200">
                      {log.entityRef}
                    </td>

                    <td className="py-3 px-3 max-w-sm leading-tight text-slate-800 font-medium border-r border-slate-200" title={log.details}>
                      {log.details}
                    </td>

                    <td className="py-3 px-3 font-mono text-[10px] text-slate-900 font-black border-r border-slate-200 select-all">
                      {log.sha256PayloadHash.substring(0, 24)}...
                    </td>

                    <td className="py-3 px-3 text-[11px] text-slate-700 font-bold border-r border-slate-200">
                      {log.performedBy}
                    </td>

                    <td className="py-3 px-3 text-right">
                      {log.rawJson ? (
                        <button
                          onClick={() => setSelectedAuditLog(log)}
                          className="p-1 bg-slate-900 hover:bg-slate-800 text-amber-400 transition cursor-pointer border border-slate-900"
                          title="Inspect Cryptographic Payload"
                        >
                          <FileCode className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="text-slate-400 text-[10px] italic">N/A</span>
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
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-4 border-slate-900 max-w-2xl w-full p-5 text-white space-y-3">
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-800">
              <h3 className="text-sm font-black text-amber-400 uppercase flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                Audit Record SHA-256 Payload Inspector ({selectedAuditLog.entityRef})
              </h3>
              <button
                onClick={() => setSelectedAuditLog(null)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer font-black"
              >
                [CLOSE]
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1 bg-slate-950 p-3 border-2 border-slate-800 font-mono">
              <p>Action: <strong className="text-amber-400">{selectedAuditLog.action}</strong></p>
              <p>Executed By: <strong>{selectedAuditLog.performedBy}</strong></p>
              <p>Cryptographic Signature:</p>
              <p className="text-emerald-400 font-black break-all">{selectedAuditLog.sha256PayloadHash}</p>
            </div>

            <pre className="bg-slate-950 p-4 border-2 border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-80">
              {JSON.stringify(selectedAuditLog.rawJson, null, 2)}
            </pre>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedAuditLog(null)}
                className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
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
