import { useMemo, useState } from 'react';
import { useHub } from '../lib/store';
import type { Invoice } from '../types';
import {
  FileText,
  Search,
  ExternalLink,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  XCircle,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { StatusBadge, statusTone, writebackTone } from './ui/StatusBadge';
import { PageHeader } from './ui/PageHeader';

type QuickView = 'ALL' | 'PENDING' | 'APPROVED' | 'ATTENTION';

const PENDING_STATUSES = ['PENDING_NRS_STAMP', 'PENDING', 'QUEUED'];
const APPROVED_STATUSES = ['APPROVED', 'SIGNED'];
const ATTENTION_STATUSES = ['REJECTED', 'FAILED'];

function money(value: unknown): string {
  return `NGN ${Number(value ?? 0).toLocaleString()}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function InvoicesTab() {
  const { invoices, activeTenant, refreshAll, isBgRefreshing } = useHub() as any;

  const [searchTerm, setSearchTerm] = useState('');
  const [quickView, setQuickView] = useState<QuickView>('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  const tenantInvoices: Invoice[] = useMemo(
    () => (invoices || []).filter((inv: Invoice) => inv.tenantId === activeTenant?.id),
    [invoices, activeTenant?.id]
  );

  const counts = useMemo(() => ({
    ALL: tenantInvoices.length,
    PENDING: tenantInvoices.filter(inv => PENDING_STATUSES.includes(inv.status)).length,
    APPROVED: tenantInvoices.filter(inv => APPROVED_STATUSES.includes(inv.status)).length,
    ATTENTION: tenantInvoices.filter(inv => ATTENTION_STATUSES.includes(inv.status)).length,
  }), [tenantInvoices]);

  const filteredInvoices = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return tenantInvoices.filter(inv => {
      const matchesSearch = !query
        || String(inv.clientInvoiceNumber || '').toLowerCase().includes(query)
        || String(inv.customerName || '').toLowerCase().includes(query)
        || String(inv.irn || '').toLowerCase().includes(query);
      const matchesQuickView =
        quickView === 'ALL'
        || (quickView === 'PENDING' && PENDING_STATUSES.includes(inv.status))
        || (quickView === 'APPROVED' && APPROVED_STATUSES.includes(inv.status))
        || (quickView === 'ATTENTION' && ATTENTION_STATUSES.includes(inv.status));
      const matchesType = typeFilter === 'ALL' || inv.invoiceType === typeFilter;
      return matchesSearch && matchesQuickView && matchesType;
    });
  }, [tenantInvoices, searchTerm, quickView, typeFilter]);

  const expandedInvoice = expandedInvoiceId
    ? tenantInvoices.find(inv => inv.id === expandedInvoiceId) || null
    : null;

  if (!activeTenant) {
    return <div className="p-8 text-center text-slate-400 text-xs">No workspace — connect an ERP to see invoices.</div>;
  }

  return (
    <div className="space-y-6 font-sans text-xs">
      <PageHeader
        icon={FileText}
        title="Normalised Invoices"
        subtitle={<>Invoices pulled from <strong className="text-white font-medium">{activeTenant.platformType}</strong> and mapped to the CittaEFS format.</>}
        actions={(
          <button
            onClick={() => refreshAll()}
            disabled={isBgRefreshing}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isBgRefreshing ? 'animate-spin' : ''}`} />
            <span>{isBgRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        )}
      />

      {/* Filters */}
      <div className="bg-white rounded-lg p-4 border border-slate-200/80 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search invoice #, IRN, or customer..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all text-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'ALL', label: 'All' },
            { id: 'PENDING', label: 'Pending' },
            { id: 'APPROVED', label: 'Approved' },
            { id: 'ATTENTION', label: 'Needs attention' },
          ] as { id: QuickView; label: string }[]).map(view => (
            <button
              key={view.id}
              onClick={() => setQuickView(view.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                quickView === view.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {view.label} <span className={quickView === view.id ? 'text-slate-300' : 'text-slate-400'}>{counts[view.id]}</span>
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
        >
          <option value="ALL">All document types</option>
          <option value="STANDARD">Standard invoice</option>
          <option value="CREDIT_NOTE">Credit note</option>
          <option value="DEBIT_NOTE">Debit note</option>
        </select>
      </div>

      {/* Invoice ledger */}
      <div className="bg-white rounded-lg border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold tracking-tight">
              {activeTenant.name} invoice ledger ({filteredInvoices.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">Read-only · normalised by the gateway</span>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-800">No invoices to show.</p>
            <p className="text-xs text-slate-500 mt-1">Invoices will appear here after the ERP syncs.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                  <th className="py-3 px-3"></th>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Total</th>
                  <th className="py-3 px-4">IRN</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Writeback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredInvoices.map(inv => {
                  const isExpanded = expandedInvoiceId === inv.id;
                  return (
                    <tr
                      key={inv.id}
                      className={`hover:bg-slate-50/80 transition-colors ${isExpanded ? 'bg-emerald-50/30' : ''}`}
                    >
                      <td className="py-3 px-3">
                        <button
                          onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                          className="text-slate-400 hover:text-emerald-700 transition-colors cursor-pointer p-1"
                          title={isExpanded ? 'Collapse invoice' : 'Expand invoice'}
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {inv.clientInvoiceNumber}
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">{formatDate(inv.issueDate)}</div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full w-max bg-slate-100 text-slate-700 border border-slate-200">
                          {inv.sourceErp || activeTenant.platformType}
                        </span>
                        <div className="text-[11px] text-slate-400 mt-1">{inv.invoiceType} · {inv.invoiceKind}</div>
                      </td>

                      <td className="py-3 px-4 max-w-[190px]">
                        <div className="font-medium text-slate-900 truncate" title={inv.customerName}>
                          {inv.customerName}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          TIN: {inv.customerTin || 'N/A'}
                        </div>
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {money(inv.grandTotal)}
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">VAT: {money(inv.totalVat)}</div>
                      </td>

                      <td className="py-3 px-4 font-mono text-[11px]">
                        {inv.irn ? (
                          <div className="flex items-center gap-1.5 text-slate-800 font-medium">
                            <span className="truncate max-w-[140px]" title={inv.irn}>{inv.irn}</span>
                            {inv.verificationLink && (
                              <a
                                href={inv.verificationLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-400 hover:text-emerald-700 p-0.5 transition-colors"
                                title="Verify on NRS portal"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-amber-600 font-medium">Pending stamp</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge tone={statusTone(inv.status)}>
                          {APPROVED_STATUSES.includes(inv.status) && <CheckCircle2 className="w-3 h-3 mr-1" />}
                          {PENDING_STATUSES.includes(inv.status) && <Clock className="w-3 h-3 mr-1" />}
                          {inv.status}
                        </StatusBadge>
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge tone={writebackTone(inv.ledgerWritebackStatus)}>
                          {inv.ledgerWritebackStatus === 'SYNCED' ? 'Synced to ERP' : 'Pending writeback'}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Read-only invoice detail */}
      {expandedInvoice && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedInvoiceId(null)}
        >
          <div
            className="bg-white w-full max-w-3xl rounded-lg border border-slate-200 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-900" />
                  {expandedInvoice.clientInvoiceNumber}
                </h4>
                <p className="text-[11px] text-slate-500 mt-1">
                  {expandedInvoice.customerName} · {expandedInvoice.invoiceType} · {expandedInvoice.invoiceKind}
                </p>
              </div>
              <button
                onClick={() => setExpandedInvoiceId(null)}
                className="p-1.5 hover:bg-white rounded-lg text-slate-500 hover:text-slate-700 border border-transparent hover:border-slate-200 cursor-pointer"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Issue date</div>
                  <div className="font-semibold text-slate-900 mt-1">{formatDate(expandedInvoice.issueDate)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due date</div>
                  <div className="font-semibold text-slate-900 mt-1">{formatDate(expandedInvoice.dueDate)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Currency</div>
                  <div className="font-semibold text-slate-900 mt-1">{expandedInvoice.currency || 'NGN'}</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment</div>
                  <div className="font-semibold text-slate-900 mt-1">{expandedInvoice.paymentStatus}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Customer</div>
                  <div className="font-semibold text-slate-900 mt-1">{expandedInvoice.customerName}</div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    {expandedInvoice.customerCode} · TIN {expandedInvoice.customerTin || 'N/A'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">CittaEFS IRN</div>
                  <div className="font-semibold text-slate-900 font-mono mt-1 break-all">
                    {expandedInvoice.irn || 'Pending stamp'}
                  </div>
                  {expandedInvoice.nrsStampTimestamp && (
                    <div className="text-[11px] text-slate-500 mt-0.5">Stamped {formatDate(expandedInvoice.nrsStampTimestamp)}</div>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="py-2 px-3">SKU</th>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3 text-center">Qty</th>
                      <th className="py-2 px-3 text-right">Unit price</th>
                      <th className="py-2 px-3 text-right">Taxable</th>
                      <th className="py-2 px-3 text-center">VAT%</th>
                      <th className="py-2 px-3">HS / Service</th>
                      <th className="py-2 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {(expandedInvoice.lineItems || []).map((line, index) => (
                      <tr key={line.id || `${expandedInvoice.id}-${index}`} className="hover:bg-slate-50/30">
                        <td className="py-2 px-3 font-mono font-semibold text-slate-900">{line.itemCode}</td>
                        <td className="py-2 px-3 text-slate-700">{line.description}</td>
                        <td className="py-2 px-3 text-center">{line.quantity}</td>
                        <td className="py-2 px-3 text-right">{money(line.unitPrice)}</td>
                        <td className="py-2 px-3 text-right">{money(line.taxableAmount)}</td>
                        <td className="py-2 px-3 text-center">{line.vatRate ?? 0}%</td>
                        <td className="py-2 px-3 font-mono text-[11px]">
                          <StatusBadge tone={line.hsOrServiceCode === 'UNMAPPED' ? 'fail' : 'neutral'}>
                            {line.hsOrServiceCode}
                          </StatusBadge>
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-slate-900">{money(line.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Subtotal</div>
                  <div className="font-semibold text-slate-900 mt-1">{money(expandedInvoice.subtotal)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Discount</div>
                  <div className="font-semibold text-slate-900 mt-1">{money(expandedInvoice.totalDiscount)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">VAT</div>
                  <div className="font-semibold text-slate-900 mt-1">{money(expandedInvoice.totalVat)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Grand total</div>
                  <div className="font-semibold text-slate-900 mt-1">{money(expandedInvoice.grandTotal)}</div>
                </div>
              </div>

              {expandedInvoice.errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{expandedInvoice.errorMessage}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 flex-wrap">
                {expandedInvoice.verificationLink && (
                  <a
                    href={expandedInvoice.verificationLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Verify on NRS
                  </a>
                )}
                <button
                  onClick={() => setExpandedInvoiceId(null)}
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
