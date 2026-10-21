import { useState, useMemo } from 'react';
import { useHub } from '../lib/store';
import { ValidationErrorItem } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  Wrench,
  FileCode,
  ArrowRight,
  Building2,
  ListFilter,
  ChevronDown,
  Search,
  X
} from 'lucide-react';
import { StatusBadge, statusTone } from './ui/StatusBadge';
import { CittaCodeSelect } from './ui/CittaCodeSelect';

/**
 * The raw gateway rejection is a large JSON blob (one entry per invoice line,
 * each carrying the full echoed request). Extract a short, human-readable
 * summary instead of dumping it verbatim — the full text is still available
 * via the "Show raw response" toggle for anyone who needs it.
 */
function summarizeErrorMessage(msg: string): { summary: string; raw: string | null } {
  const gatewayMatch = msg.match(/^CittaEFS Gateway error \((\d+)\):\s*(\{[\s\S]*)/);
  if (gatewayMatch) {
    try {
      const parsed = JSON.parse(gatewayMatch[2]);
      const rows: string[] = (parsed.errors || []).map((e: any) => {
        const item = e.request?.itemName || e.request?.itemDescription || `row ${e.rowNumber ?? '?'}`;
        const reason = e.error || 'Rejected by gateway';
        const actual = e.actualValue !== undefined ? ` (got "${e.actualValue}")` : '';
        return `${item}: ${reason}${actual}`;
      });
      const shown = rows.slice(0, 3);
      const more = rows.length > 3 ? ` — +${rows.length - 3} more line(s)` : '';
      const summary = shown.length
        ? `Gateway rejected (HTTP ${gatewayMatch[1]}): ${shown.join(' · ')}${more}`
        : `Gateway rejected the invoice (HTTP ${gatewayMatch[1]}).`;
      return { summary, raw: msg };
    } catch {
      // Unparseable/truncated JSON — fall through to plain truncation below.
    }
  }
  if (msg.length > 220) {
    return { summary: msg.slice(0, 220) + '…', raw: msg };
  }
  return { summary: msg, raw: null };
}

export function ValidationErrorsTab({ onNavigate }: { onNavigate?: (t: string) => void } = {}) {
  const { validationErrors, activeTenant, resolveValidationError, currentUser, refreshAll } = useHub() as any;

  const [selectedError, setSelectedError] = useState<ValidationErrorItem | null>(null);
  const [selectedHsCode, setSelectedHsCode] = useState<string>('');
  const [correctedTin, setCorrectedTin] = useState<string>('P019283746Z');
  const [isResolving, setIsResolving] = useState(false);
  const [isBulkFixing, setIsBulkFixing] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [showRawError, setShowRawError] = useState(false);

  const tenantErrors = validationErrors.filter(e => e.tenantId === activeTenant.id);
  const openErrors = tenantErrors.filter(e => e.status === 'OPEN');
  const resolvedErrors = tenantErrors.filter(e => e.status === 'RESOLVED');

  const handleResolve = async () => {
    if (!selectedError) return;
    if (selectedError.errorCategory === 'MISSING_HS_CODE' && !selectedHsCode) return;

    setIsResolving(true);
    let data: any = null;
    try {
      data = await resolveValidationError(
        selectedError.id,
        selectedError.errorCategory === 'MISSING_HS_CODE' ? selectedHsCode : undefined,
        selectedError.errorCategory === 'INVALID_TIN_FORMAT' ? correctedTin : undefined
      );
    } catch {
      // toast already shown by the store action — stay put so the user sees it
    }
    setIsResolving(false);
    setSelectedError(null);
    // Only leave for Invoices when something actually propagated — otherwise
    // navigating away read as "it worked" when the fix silently failed
    // (nothing was created/queued), and hid the real outcome + any new error.
    const propagated = data && (data.invoiceCreated || (data.requeued ?? 0) > 0);
    if (propagated && onNavigate) onNavigate('invoices');
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-amber-500 rounded-lg text-slate-950 shrink-0 shadow-md shadow-amber-500/20">
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
          <button onClick={() => onNavigate ? onNavigate('invoices') : null} title="Validation is fix-only — propagate in Invoices" className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded-full font-semibold">Go to Invoices →</button>
        </div>
      </div>

      {/* Simplified — grouped dropdowns to reduce cognitive overload */}
      {tenantErrors.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-lg shadow-sm p-10 text-center text-slate-800">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <p className="text-base font-bold text-slate-900">Zero Validation Errors</p>
          <p className="text-xs text-slate-500 mt-1">All transactions comply with CittaEFS & NRS — verbose errors hidden.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            const grouped = openErrors.reduce((acc:any, e:any)=>{ (acc[e.errorCategory]=acc[e.errorCategory]||[]).push(e); return acc; }, {} as Record<string, any[]>);
            const cats = Object.keys(grouped);
            if (cats.length===0) return (
              <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500">No open errors — {resolvedErrors.length} resolved hidden. <button onClick={()=>setShowResolved(v=>!v)} className="text-slate-900 underline ml-1">{showResolved?'Hide':'Show'} resolved</button></div>
            );
            return (
              <>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] text-slate-500">Grouped by category — click dropdown to expand verbose details</span>
                  <button onClick={()=>setShowResolved(v=>!v)} className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1">{showResolved?'Hide':'Show'} resolved ({resolvedErrors.length}) <ChevronDown className={`w-3 h-3 transition ${showResolved?'rotate-180':''}`} /></button>
                </div>
                {cats.map(cat=>{
                  const list = grouped[cat];
                  const isOpen = openCategory===cat;
                  return (
                    <div key={cat} className="bg-white border border-slate-200/80 rounded-lg shadow-sm overflow-hidden">
                      <button onClick={()=>setOpenCategory(isOpen?null:cat)} className={`w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer ${isOpen?'bg-amber-50/50':''} hover:bg-slate-50`}>
                        <div className="flex items-center gap-3">
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-full text-[10px] font-bold">{cat}</span>
                          <span className="text-xs font-bold text-slate-900">{list.length} error(s)</span>
                          <span className="hidden sm:inline text-[11px] text-slate-500">— {list[0]?.fieldAffected} • {list[0] && summarizeErrorMessage(list[0].errorMessage).summary.slice(0,80)}</span>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition ${isOpen?'rotate-180':''}`} />
                      </button>
                      {isOpen && (
                        <div className="overflow-x-auto border-t border-slate-100">
                          <table className="w-full text-left border-collapse text-xs text-slate-900">
                            <thead><tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100"><th className="py-2 px-4">Status</th><th className="py-2 px-4">Invoice #</th><th className="py-2 px-4">Field</th><th className="py-2 px-4">Verbose Description ↓</th><th className="py-2 px-4 text-right">Action</th></tr></thead>
                            <tbody className="divide-y divide-slate-100">
                              {list.map((err:any)=>(
                                <tr key={err.id} className="hover:bg-slate-50/60">
                                  <td className="py-2.5 px-4"><StatusBadge tone={statusTone(err.status)}>{err.status}</StatusBadge></td>
                                  <td className="py-2.5 px-4 font-mono font-bold">{err.clientInvoiceNumber}</td>
                                  <td className="py-2.5 px-4 font-mono text-[11px]">{err.fieldAffected}</td>
                                  <td className="py-2.5 px-4 max-w-md text-slate-600 text-[11px] leading-relaxed whitespace-normal break-words" title={err.errorMessage}>{summarizeErrorMessage(err.errorMessage).summary}</td>
                                  <td className="py-2.5 px-4 text-right"><button onClick={()=>{setSelectedError(err); setSelectedHsCode(''); setShowRawError(false);}} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-lg inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> Fix</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
                {showResolved && resolvedErrors.length>0 && (
                  <div className="bg-white border border-emerald-200 rounded-lg overflow-hidden">
                    <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100 text-xs font-bold text-emerald-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Resolved ({resolvedErrors.length}) — hidden by default</div>
                    <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                      {resolvedErrors.slice(0,20).map((e:any)=>(<div key={e.id} className="px-4 py-2 flex items-center justify-between text-xs"><span className="font-mono font-semibold">{e.clientInvoiceNumber}</span><span className="text-slate-500">{e.errorCategory}</span><span className="text-emerald-700 font-semibold">RESOLVED</span></div>))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* 1-CLICK RESOLUTION MODAL */}
      {selectedError && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-6 text-slate-900 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-emerald-700" />
                1-Click Resolution for {selectedError.clientInvoiceNumber}
              </h3>
              <button
                onClick={() => setSelectedError(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50 rounded-lg border border-amber-200/80 p-3.5 text-xs text-amber-900 space-y-1.5">
              <p><strong>Affected Field:</strong> <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300/80 font-bold text-amber-950">{selectedError.fieldAffected}</code></p>
              {(() => {
                const { summary, raw } = summarizeErrorMessage(selectedError.errorMessage);
                return (
                  <>
                    <p className="text-amber-800"><strong>Error:</strong> {summary}</p>
                    {raw && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowRawError(v => !v)}
                          className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 underline cursor-pointer"
                        >
                          {showRawError ? 'Hide raw response' : 'Show raw response'}
                        </button>
                        {showRawError && (
                          <pre className="max-h-40 overflow-y-auto bg-white border border-amber-200/80 rounded-lg p-2.5 text-[10px] text-slate-600 whitespace-pre-wrap break-words font-mono">{raw}</pre>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
            </div>

            {selectedError.errorCategory === 'MISSING_HS_CODE' && (
              <div className="space-y-2 text-xs">
                <label className="block font-medium text-slate-700">
                  Select Official CittaEFS Code Mapping:
                </label>
                <CittaCodeSelect value={selectedHsCode} onChange={setSelectedHsCode} hint="Type a code or keyword (e.g. 8471 or laptop)…" />
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
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all uppercase"
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
                disabled={isResolving || (selectedError.errorCategory === 'MISSING_HS_CODE' && !selectedHsCode)}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-1.5 transition-colors disabled:opacity-50 font-sans"
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
