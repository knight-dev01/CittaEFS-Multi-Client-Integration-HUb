import { useState } from 'react';
import { useHub } from '../lib/store';
import {
  Search,
  Download,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ChevronDown
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  entityType: 'CUSTOMER' | 'ITEM';
  icon: LucideIcon;
  title: string;
  subtitle: string;
  searchHint: string;
  emptyMessage: string;
  howItWorks: [string, string, string];
  detailLine: (m: any) => string;
}

// Shared registration-queue UI for CittaEFS entities (customer or item) the
// Hub has seen from a client ERP but hasn't registered with CittaEFS yet —
// CittaEFS owns the record, there's no registration API, so this is a queue
// to clear via its own Excel bulk-upload template, not a directory to edit.
// Both entity types drive off the same generic EntityMapping model/API
// (see src/routes/entityMappings.ts), so this one component serves both
// CustomerSyncTab and ItemDictionaryTab's registration section.
export function EntityRegistrationQueue({ entityType, icon: Icon, title, subtitle, searchHint, emptyMessage, howItWorks, detailLine }: Props) {
  const { entityMappings, activeTenant, exportEntityRegistrations, confirmEntityRegistration } = useHub() as any;

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refCodeDraft, setRefCodeDraft] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const tenantMappings = entityMappings.filter(
    (m: any) => m.tenantId === activeTenant.id && m.entityType === entityType
  );

  const filtered = tenantMappings.filter((m: any) => {
    const matchesSearch =
      (m.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.sourceErpId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.tin || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = tenantMappings.filter((m: any) => m.status === 'PENDING_REGISTRATION').length;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportEntityRegistrations(entityType, activeTenant.id);
    } catch {
      // toast already shown by the store action
    } finally {
      setIsExporting(false);
    }
  };

  const handleConfirm = async (mappingId: string) => {
    if (!refCodeDraft.trim()) {
      setConfirmError('Enter the CittaEFS reference code returned after upload.');
      return;
    }
    setConfirmError('');
    setIsConfirming(true);
    try {
      await confirmEntityRegistration(mappingId, refCodeDraft.trim());
      setExpandedId(null);
      setRefCodeDraft('');
    } catch (e: any) {
      setConfirmError(e.message || 'Failed to confirm registration.');
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="space-y-6 font-sans text-xs">

      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-white">
              {activeTenant.name} — {title}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {subtitle}{pendingCount > 0 ? ` — ${pendingCount} awaiting registration` : ''}
            </p>
          </div>
        </div>

        <button
          onClick={handleExport}
          disabled={isExporting || pendingCount === 0}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center space-x-2 shrink-0"
        >
          <Download className="w-4 h-4 text-indigo-200" />
          <span>{isExporting ? 'Preparing…' : 'Download EFS Registration File'}</span>
        </button>
      </div>

      {/* How this works — collapsed behind dropdown */}
      <details className="bg-white rounded-xl border border-slate-200/80 shadow-sm group">
        <summary className="list-none px-5 py-3 flex items-center justify-between cursor-pointer text-xs font-semibold text-slate-700">
          <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-500" /> How registration works — click for details</span>
          <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition" />
        </summary>
        <div className="px-5 pb-4 text-xs text-slate-600 space-y-1.5">
          <p>1. {howItWorks[0]}</p>
          <p>2. {howItWorks[1]}</p>
          <p>3. {howItWorks[2]}</p>
        </div>
      </details>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-xl p-4 border border-slate-200/80 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={searchHint}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-600">
          <span className="font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
          >
            <option value="ALL">All</option>
            <option value="PENDING_REGISTRATION">Pending Registration</option>
            <option value="MAPPED">Registered</option>
          </select>
        </div>
      </div>

      {/* Registration Queue */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Sourced from client ERP activity — not editable here</span>
          <span className="text-[11px] font-semibold text-slate-600">{filtered.length} {entityType === 'CUSTOMER' ? 'customer(s)' : 'item(s)'}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 font-medium">
            {tenantMappings.length === 0 ? emptyMessage : 'No matches for your search query.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((m: any) => {
              const isOpen = expandedId === m.id;
              const isMapped = m.status === 'MAPPED';
              return (
                <div key={m.id} className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`shrink-0 p-2 rounded-lg border ${isMapped ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-amber-50 border-amber-200 text-amber-600'}`}>
                        {isMapped ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{m.displayName || m.sourceErpId}</div>
                        <div className="text-[11px] font-mono text-slate-500 truncate">{detailLine(m)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`inline-flex items-center px-2.5 py-1 text-[10px] font-bold rounded-full border ${isMapped ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        {isMapped ? 'REGISTERED' : 'PENDING REGISTRATION'}
                      </span>
                      {!isMapped && (
                        <button
                          onClick={() => { setExpandedId(isOpen ? null : m.id); setConfirmError(''); setRefCodeDraft(''); }}
                          className="px-3 py-1.5 text-[11px] font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                        >
                          Confirm Registered
                        </button>
                      )}
                    </div>
                  </div>

                  {isMapped && (
                    <div className="mt-2 pl-11 text-[11px] text-slate-500">
                      CittaEFS reference: <span className="font-mono text-slate-700">{m.cittaReferenceCode}</span>
                    </div>
                  )}

                  {isOpen && !isMapped && (
                    <div className="mt-3 pl-11 flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                      <input
                        type="text"
                        placeholder="CittaEFS reference code from the upload result"
                        value={refCodeDraft}
                        onChange={(e) => setRefCodeDraft(e.target.value)}
                        className="w-full sm:w-72 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      />
                      <button
                        onClick={() => handleConfirm(m.id)}
                        disabled={isConfirming}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
                      >
                        {isConfirming ? 'Confirming…' : entityType === 'CUSTOMER' ? 'Save & Resubmit Invoices' : 'Save Registration'}
                      </button>
                    </div>
                  )}
                  {isOpen && confirmError && (
                    <div className="mt-2 pl-11 text-[11px] text-rose-600 font-medium">{confirmError}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
