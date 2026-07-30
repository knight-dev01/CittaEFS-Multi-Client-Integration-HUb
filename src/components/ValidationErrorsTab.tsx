import { useState } from 'react';
import { useHub } from '../lib/store';
import { ValidationErrorItem } from '../types';
import { CITTA_HS_CODES_REFERENCE, CITTA_SERVICE_CODES_REFERENCE } from '../data/mockData';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Wrench, 
  FileCode, 
  ArrowRight, 
  Building2,
  ListFilter
} from 'lucide-react';

export function ValidationErrorsTab() {
  const { validationErrors, activeTenant, resolveValidationError, currentUser } = useHub();

  const isAuditor = currentUser?.role === 'AUDITOR';

  const [selectedError, setSelectedError] = useState<ValidationErrorItem | null>(null);
  const [selectedHsCode, setSelectedHsCode] = useState<string>('HS-3926.90');
  const [correctedTin, setCorrectedTin] = useState<string>('P019283746Z');
  const [isResolving, setIsResolving] = useState(false);

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
  };

  return (
    <div className="space-y-6">
      
      {/* Header Summary */}
      <div className="bg-slate-900 border-2 border-slate-900 p-5 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4 font-mono">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-amber-400 border border-slate-900 text-slate-950 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-amber-400 uppercase tracking-tight">
              Pre-Flight Validation Errors Queue ({openErrors.length} Open)
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Automated pre-flight guard catching unmapped SKUs, missing HS/Service codes, and malformed TINs before sending to CittaEFS.
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs">
          <span className="px-3 py-1 bg-amber-400 text-slate-950 border border-slate-900 font-black uppercase">
            {openErrors.length} Open Rejections
          </span>
          <span className="px-3 py-1 bg-emerald-400 text-slate-950 border border-slate-900 font-black uppercase">
            {resolvedErrors.length} Auto-Resolved
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden font-mono">
        <div className="px-4 py-3 bg-slate-900 text-white border-b-2 border-slate-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ListFilter className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-black uppercase tracking-wider">
              {activeTenant.name} Exception List
            </h3>
          </div>
        </div>

        {tenantErrors.length === 0 ? (
          <div className="p-8 text-center text-slate-900">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
            <p className="text-sm font-black uppercase">Zero Validation Errors Detected!</p>
            <p className="text-xs text-slate-600 mt-1">All ingested transactions comply 100% with CittaEFS & NRS specifications.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs text-slate-900">
              <thead>
                <tr className="bg-slate-100 text-slate-900 uppercase text-[10px] tracking-wider border-b-2 border-slate-900">
                  <th className="py-2.5 px-3 border-r border-slate-300">Status</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Client Invoice #</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Error Category</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Field Affected</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Error Description</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Detected At</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {tenantErrors.map((err) => (
                  <tr key={err.id} className="hover:bg-slate-100 transition">
                    <td className="py-3 px-3 border-r border-slate-200">
                      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border border-slate-900 uppercase ${
                        err.status === 'OPEN' ? 'bg-amber-400 text-slate-950' : 'bg-emerald-400 text-slate-950'
                      }`}>
                        {err.status}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-black text-slate-900 font-mono border-r border-slate-200">
                      {err.clientInvoiceNumber}
                    </td>

                    <td className="py-3 px-3 border-r border-slate-200">
                      <span className="px-1.5 py-0.5 bg-slate-900 text-white font-black text-[10px] uppercase">
                        {err.errorCategory}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-mono text-[10px] text-slate-900 font-black border-r border-slate-200">
                      {err.fieldAffected}
                    </td>

                    <td className="py-3 px-3 max-w-xs truncate text-slate-900 font-medium border-r border-slate-200" title={err.errorMessage}>
                      {err.errorMessage}
                    </td>

                    <td className="py-3 px-3 text-[10px] text-slate-600 font-mono border-r border-slate-200">
                      {err.createdAt}
                    </td>

                    <td className="py-3 px-3 text-right">
                      {err.status === 'OPEN' ? (
                        !isAuditor ? (
                          <button
                            onClick={() => {
                              setSelectedError(err);
                              if (err.errorCategory === 'MISSING_HS_CODE') setSelectedHsCode('HS-3926.90');
                            }}
                            className="px-3 py-1 bg-amber-400 border border-slate-900 text-slate-950 font-black text-xs hover:bg-amber-300 transition cursor-pointer inline-flex items-center space-x-1 uppercase"
                          >
                            <Wrench className="w-3.5 h-3.5" />
                            <span>1-Click Fix</span>
                          </button>
                        ) : (
                          <span className="text-slate-500 font-bold uppercase text-[11px]">
                            Awaiting Action
                          </span>
                        )
                      ) : (
                        <span className="text-emerald-700 font-black text-[11px] uppercase">
                          Resolved & Stamped
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
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4 font-mono">
          <div className="bg-white border-4 border-slate-900 max-w-lg w-full p-6 text-slate-900 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-900">
              <h3 className="text-sm font-black text-slate-900 uppercase flex items-center gap-2">
                <Wrench className="w-4 h-4 text-amber-500" />
                1-Click Resolution for {selectedError.clientInvoiceNumber}
              </h3>
              <button
                onClick={() => setSelectedError(null)}
                className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer font-black"
              >
                [CANCEL]
              </button>
            </div>

            <div className="bg-amber-100 border-2 border-slate-900 p-3 text-xs text-slate-950 space-y-1">
              <p><strong>Affected Field:</strong> <code className="font-mono bg-white px-1 py-0.5 border border-slate-900 font-black">{selectedError.fieldAffected}</code></p>
              <p><strong>Error:</strong> {selectedError.errorMessage}</p>
            </div>

            {selectedError.errorCategory === 'MISSING_HS_CODE' && (
              <div className="space-y-2 text-xs">
                <label className="block font-black text-slate-900 uppercase">
                  Select Official CittaEFS Code Mapping:
                </label>
                <select
                  value={selectedHsCode}
                  onChange={(e) => setSelectedHsCode(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 bg-white font-black text-slate-900 focus:outline-none"
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
                <p className="text-[11px] text-slate-600">
                  Resolving will automatically register this code in the Item Dictionary and re-transmit invoice {selectedError.clientInvoiceNumber} to CittaEFS.
                </p>
              </div>
            )}

            {selectedError.errorCategory === 'INVALID_TIN_FORMAT' && (
              <div className="space-y-2 text-xs">
                <label className="block font-black text-slate-900 uppercase">
                  Corrected Tax Identification Number (TIN):
                </label>
                <input
                  type="text"
                  value={correctedTin}
                  onChange={(e) => setCorrectedTin(e.target.value)}
                  placeholder="e.g. P051239841A"
                  className="w-full px-3 py-2 border-2 border-slate-900 font-mono font-black text-slate-900 focus:outline-none uppercase"
                />
                <p className="text-[11px] text-slate-600">
                  Must follow standard NRS Taxpayer TIN format (Starts with P, followed by 9 digits and ending with letter).
                </p>
              </div>
            )}

            <div className="pt-2 flex justify-end space-x-2">
              <button
                onClick={() => setSelectedError(null)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={isResolving}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer inline-flex items-center space-x-1"
              >
                <span>{isResolving ? 'Re-Transmitting...' : 'Fix & Re-Transmit Invoice'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
