import { useState } from 'react';
import { useHub } from '../lib/store';
import { ValidationErrorItem } from '../types';
import { CITTA_HS_CODES_REFERENCE, CITTA_SERVICE_CODES_REFERENCE } from '../data/referenceData';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Wrench, 
  FileCode, 
  ArrowRight, 
  Building2,
  ListFilter,
  X
} from 'lucide-react';

export function ValidationErrorsTab({ onNavigate }: { onNavigate?: (t: string) => void } = {}) {
  const { validationErrors, activeTenant, resolveValidationError, currentUser, refreshAll } = useHub() as any;

  const [selectedError, setSelectedError] = useState<ValidationErrorItem | null>(null);
  const [selectedHsCode, setSelectedHsCode] = useState<string>('HS-3926.90');
  const [correctedTin, setCorrectedTin] = useState<string>('P019283746Z');
  const [isResolving, setIsResolving] = useState(false);
  const [isBulkFixing, setIsBulkFixing] = useState(false);

  const tenantErrors = validationErrors.filter(e => e.tenantId === activeTenant.id);
  const openErrors = tenantErrors.filter(e => e.status === 'OPEN');
  const resolvedErrors = tenantErrors.filter(e => e.status === 'RESOLVED');

  const handleResolve = async () => {
    if (!selectedError) return;

    setIsResolving(true);
    await resolveValidationError(
      selectedError.id,
      selectedError.errorCategory === 'MISSING_HS_CODE' ? selectedHsCode : undefined,
      selectedError.errorCategory === 'INVALID_TIN_FORMAT' ? correctedTin : undefined
    );
    setIsResolving(false);
    setSelectedError(null);
    // Validation is fix-only — direct to Invoices for propagation (single retry module)
    if (onNavigate) onNavigate('invoices');
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-amber-500 rounded-xl text-slate-950 shrink-0 shadow-md shadow-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Pre-Flight Validation Errors Queue ({openErrors.length} Open)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Automated pre-flight guard catching unmapped SKUs, missing HS/Service codes, and malformed TINs before sending to CittaEFS.
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs shrink-0 font-sans">
          <span className="px-3 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-full font-medium">
            {openErrors.length} Open Rejections
          </span>
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-medium">
            {resolvedErrors.length} Auto-Resolved
          </span>
          <button onClick={async () => {
            if (openErrors.length===0) return;
            if (!confirm(`Bulk fix ${openErrors.length} open validation errors? This marks them RESOLVED.`)) return;
            setIsBulkFixing(true);
            try {
              const { fetchWithAuth, parseJsonResponse } = await import('../lib/api');
              const res = await fetchWithAuth('/api/validation-errors/bulk-resolve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tenantId: activeTenant.id }) });
              await parseJsonResponse(res);
              await refreshAll();
            } catch(e:any){ alert(e.message); } finally { setIsBulkFixing(false); }
          }} disabled={isBulkFixing || openErrors.length===0} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-semibold disabled:opacity-50 cursor-pointer flex items-center gap-1">
            <Wrench className={`w-3 h-3 ${isBulkFixing?'animate-spin':''}`} /> {isBulkFixing ? 'Fixing…' : `One-Click Bulk Fix (${openErrors.length})`}
          </button>
          <button onClick={() => onNavigate ? onNavigate('invoices') : null} title="Validation is fix-only — propagate in Invoices" className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-full font-semibold">Go to Invoices →</button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ListFilter className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider">
              {activeTenant.name} Exception List
            </h3>
          </div>
        </div>

        {tenantErrors.length === 0 ? (
          <div className="p-10 text-center text-slate-800">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-base font-bold text-slate-900">Zero Validation Errors Detected!</p>
            <p className="text-xs text-slate-500 mt-1">All ingested transactions comply 100% with CittaEFS & NRS specifications.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs text-slate-900">
              <thead>
                <tr className="bg-slate-50/80 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Client Invoice #</th>
                  <th className="py-3 px-4">Error Category</th>
                  <th className="py-3 px-4">Field Affected</th>
                  <th className="py-3 px-4">Error Description</th>
                  <th className="py-3 px-4">Detected At</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tenantErrors.map((err) => (
                  <tr key={err.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-semibold rounded-full border ${
                        err.status === 'OPEN' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {err.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {err.clientInvoiceNumber}
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-medium rounded-full text-[10px]">
                        {err.errorCategory}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-700 font-medium">
                      {err.fieldAffected}
                    </td>

                    <td className="py-3.5 px-4 max-w-xs truncate text-slate-600 font-medium" title={err.errorMessage}>
                      {err.errorMessage}
                    </td>

                    <td className="py-3.5 px-4 text-xs text-slate-500 font-mono">
                      {err.createdAt}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      {err.status === 'OPEN' ? (
                        <button
                          onClick={() => {
                            setSelectedError(err);
                            if (err.errorCategory === 'MISSING_HS_CODE') setSelectedHsCode('HS-3926.90');
                          }}
                          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer inline-flex items-center space-x-1.5 shadow-sm"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          <span>1-Click Fix</span>
                        </button>
                      ) : (
                        <span className="text-emerald-700 font-semibold text-xs inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Resolved
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 1-CLICK RESOLUTION MODAL */}
      {selectedError && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 text-slate-900 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-indigo-600" />
                1-Click Resolution for {selectedError.clientInvoiceNumber}
              </h3>
              <button
                onClick={() => setSelectedError(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50 rounded-xl border border-amber-200/80 p-3.5 text-xs text-amber-900 space-y-1">
              <p><strong>Affected Field:</strong> <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300/80 font-bold text-amber-950">{selectedError.fieldAffected}</code></p>
              <p className="text-amber-800"><strong>Error:</strong> {selectedError.errorMessage}</p>
            </div>

            {selectedError.errorCategory === 'MISSING_HS_CODE' && (
              <div className="space-y-2 text-xs">
                <label className="block font-medium text-slate-700">
                  Select Official CittaEFS Code Mapping:
                </label>
                <select
                  value={selectedHsCode}
                  onChange={(e) => setSelectedHsCode(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                >
                  <optgroup label="Physical Goods (HS Codes)">
                    {CITTA_HS_CODES_REFERENCE.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.code} - {c.name} ({c.defaultVat}% VAT)
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Services (Service Codes)">
                    {CITTA_SERVICE_CODES_REFERENCE.map(s => (
                      <option key={s.code} value={s.code}>
                        {s.code} - {s.name} ({s.defaultVat}% VAT)
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Resolving will automatically register this code in the Item Dictionary and re-transmit invoice {selectedError.clientInvoiceNumber} to CittaEFS.
                </p>
              </div>
            )}

            {selectedError.errorCategory === 'INVALID_TIN_FORMAT' && (
              <div className="space-y-2 text-xs">
                <label className="block font-medium text-slate-700">
                  Corrected Tax Identification Number (TIN):
                </label>
                <input
                  type="text"
                  value={correctedTin}
                  onChange={(e) => setCorrectedTin(e.target.value)}
                  placeholder="e.g. P051239841A"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all uppercase"
                />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Must follow standard NRS Taxpayer TIN format (Starts with P, followed by 9 digits and ending with letter).
                </p>
              </div>
            )}

            <div className="pt-2 flex justify-end space-x-2">
              <button
                onClick={() => setSelectedError(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={isResolving}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-1.5 transition-colors disabled:opacity-50 font-sans"
              >
                <span>{isResolving ? 'Fixing…' : 'Fix'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
