import { useState, useEffect, useRef } from 'react';
import { useHub } from '../lib/store';
import { Invoice, InvoiceType, InvoiceKind, InvoiceStatus } from '../types';
import {
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  QrCode,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Send,
  Pencil,
  Save,
  RotateCcw,
  Clock,
  Trash2,
  Plus
} from 'lucide-react';
import { OverlaySelect } from './ui/OverlaySelect';
import { toastGlobal } from './ui/Toast';
import { StatusBadge, statusTone, writebackTone } from './ui/StatusBadge';
import { CittaCodeSelect } from './ui/CittaCodeSelect';

export function InvoicesTab({ onNavigate }: { onNavigate?: (tab: string) => void } = {}) {
  const { invoices, activeTenant, customers, itemMappings, cancelInvoice, transmitInvoice, currentUser, updateInvoice, deleteInvoice, refreshAll, retryInvoice, retryBulkInvoices, isBgRefreshing } = useHub() as any;
  const tenantCustomers = (customers || []).filter((c:any) => c.tenantId === activeTenant?.id);
  const tenantItems = (itemMappings || []).filter((m:any) => m.tenantId === activeTenant?.id);

  // Both Admin and Operator have access here.

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  // Modals — keep only QR (per-row overlay is expandedInvoiceId)
  const [qrModalInvoice, setQrModalInvoice] = useState<Invoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [expandedSending, setExpandedSending] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [isBulkRetrying, setIsBulkRetrying] = useState(false);

  const tenantInvoices = invoices.filter(inv => inv.tenantId === activeTenant.id);

  const filteredInvoices = tenantInvoices.filter(inv => {
    const matchesSearch =
      inv.clientInvoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.irn && inv.irn.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ATTENTION' && ['REJECTED','FAILED'].includes(inv.status)) ||
      (statusFilter === 'PENDING' && ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(inv.status)) ||
      (statusFilter === 'APPROVED' && ['APPROVED','SIGNED'].includes(inv.status)) ||
      inv.status === statusFilter;
    const matchesType = typeFilter === 'ALL' || inv.invoiceType === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  const handleCancelInvoice = async (inv: Invoice) => {
    if (confirm(`Are you sure you want to trigger regulatory revocation for IRN ${inv.irn || inv.clientInvoiceNumber}?`)) {
      await cancelInvoice(inv.id, 'User requested revocation via Control Panel');
    }
  };

  const [bulkMsg, setBulkMsg] = useState<{type:'success'|'error', text:string} | null>(null);
  const [showVerboseErrors, setShowVerboseErrors] = useState(false);
  // Sequential: pending locked until NRS settles — Send/Retry not allowed for PENDING
  const pendingBulk = filteredInvoices.filter(inv => ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(inv.status));
  const hasPending = pendingBulk.length > 0;
  const retryableBulk = filteredInvoices.filter(inv => ['REJECTED','FAILED'].includes(inv.status));
  const isRetryable = (status:string) => ['REJECTED','FAILED'].includes(status);
  const hasRetryable = retryableBulk.length > 0;
  // Unified propagation guard — any CittaEFS send/retry in flight dulls ALL propagation buttons
  const isAnyPropagating = !!sendingId || !!retryingId || expandedSending || isBulkRetrying || isBgRefreshing;
  const [propagatingSince, setPropagatingSince] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (isAnyPropagating && propagatingSince === null) setPropagatingSince(Date.now());
    if (!isAnyPropagating) { setPropagatingSince(null); setElapsedSec(0); }
  }, [isAnyPropagating, propagatingSince]);
  useEffect(() => {
    if (!isAnyPropagating || propagatingSince === null) return;
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - propagatingSince) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isAnyPropagating, propagatingSince]);

  const handleRetry = async (inv: Invoice) => {
    if (retryingId) return;
    setRetryingId(inv.id);
    try {
      await retryInvoice(inv.id);
      setBulkMsg({type:'success', text:`Retry queued for ${inv.clientInvoiceNumber} — will re-attempt CittaEFS gateway (5 retries: 5s/30s/2m/10m/30m)`});
    } catch (e:any) {
      setBulkMsg({type:'error', text: e.message || 'Retry failed'});
    } finally { setRetryingId(null); }
  };
  const handleBulkRetry = async () => {
    if (retryableBulk.length===0) { toastGlobal('info','Nothing to retry','No REJECTED/PENDING invoices'); return; }
    if (!confirm(`Retry ${retryableBulk.length} invoice(s) that didn't go through? This re-queues them for CittaEFS with fresh 5 attempts.`)) return;
    setIsBulkRetrying(true);
    try {
      const res = await retryBulkInvoices(activeTenant.id, retryableBulk.map((i:any)=>i.id));
      setBulkMsg({type:'success', text:`Bulk retry: ${res.retried}/${res.total} re-queued`});
    } catch (e:any) { setBulkMsg({type:'error', text: e.message}); } finally { setIsBulkRetrying(false); }
  };
  const resolveTin = (inv: any): string | undefined => {
    if (inv.customerTin && inv.customerTin.length >= 8 && inv.customerTin !== 'N/A') return inv.customerTin;
    const master = (customers || []).find((c:any) => c.clientCustomerCode === inv.customerCode || c.clientSystemCustId === inv.customerCode);
    if (master?.tin && master.tin.length >= 8 && master.tin !== 'N/A') return master.tin;
    if (master?.taxId && master.taxId.length >= 8 && master.taxId !== 'N/A') return master.taxId;
    return inv.customerTin;
  };

  // Strict validation — clear, actionable messages (user-fixable)
  const getInvoiceErrors = (inv: any): string[] => {
    const errs: string[] = [];
    const num = String(inv.clientInvoiceNumber || '').trim();
    if (!num) errs.push('Invoice Number is required — enter at least 3 characters (e.g. INV-001)');
    else if (num.length < 3) errs.push(`Invoice Number "${num}" is too short — use at least 3 characters (e.g. INV-001)`);
    if (!inv.issueDate || isNaN(Date.parse(inv.issueDate))) errs.push('Issue Date is missing or invalid — pick a valid calendar date');
    if (!inv.customerCode || String(inv.customerCode).trim().length < 2) errs.push('Customer Code is required — enter at least 2 characters (e.g. CUST-001). Check Customers tab');
    if (!inv.customerName || String(inv.customerName).trim().length < 2) errs.push('Customer Name is required — enter at least 2 characters');
    const tin = resolveTin(inv);
    const isB2B = inv.invoiceKind==='B2B' || inv.invoiceKind==='B2G';
    if (isB2B) {
      if (!tin || String(tin).trim()==='' || String(tin).trim()==='N/A') errs.push('Customer TIN is required for B2B/B2G — enter 8-14 alphanumeric chars (e.g. 12345678-0001). Edit TIN in this overlay or in Customers tab');
      else if (!/^[A-Za-z0-9-]{8,14}$/.test(String(tin).trim())) errs.push(`Customer TIN "${String(tin).trim()}" is invalid — use 8-14 letters/numbers/hyphens (e.g. 12345678-0001)`);
    }
    if (!inv.lineItems || inv.lineItems.length===0) errs.push('At least one line item is required — add an item row');
    else inv.lineItems.forEach((li:any, idx:number)=>{
      const line = `Line ${idx+1}`;
      if (!li.itemCode || String(li.itemCode).trim().length<2) errs.push(`${line}: SKU / Item Code is required — enter at least 2 characters (e.g. SKU-001)`);
      if (!li.hsOrServiceCode || li.hsOrServiceCode==='UNMAPPED' || li.hsOrServiceCode==='SERV-DEFAULT' || String(li.hsOrServiceCode).trim()==='') errs.push(`${line} ("${li.description||li.itemCode||'item'}"): HS/Service Code is missing or UNMAPPED — enter a valid HS code (e.g. 8471.30) or map it in Items`);
      if (li.quantity===undefined || li.quantity==='' || Number(li.quantity) <=0) errs.push(`${line}: Quantity must be greater than 0 — enter a positive number`);
      if (li.unitPrice===undefined || li.unitPrice==='' || isNaN(Number(li.unitPrice)) ) errs.push(`${line}: Unit Price is required — enter a number (e.g. 5000)`);
      else if (Number(li.unitPrice) <0) errs.push(`${line}: Unit Price cannot be negative`);
      if (li.vatRate===undefined || li.vatRate==='' || isNaN(Number(li.vatRate))) errs.push(`${line}: VAT Rate is required — enter 0 to 100 (e.g. 7.5)`);
      else if (Number(li.vatRate) <0 || Number(li.vatRate) >100) errs.push(`${line}: VAT Rate must be between 0 and 100 (got ${li.vatRate})`);
    });
    return errs;
  };
  return (
    <div className="space-y-6">

      {/* Top Action Bar & Filters */}
      <div className="bg-white rounded-lg p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 font-sans">

        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search Invoice #, IRN, or Customer Name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 transition-all text-slate-900"
          />
        </div>

        {/* Quick views */}
        <div className="flex flex-wrap items-center gap-1.5 font-sans">
          {[
            { id: 'ALL', label: 'All' },
            { id: 'ATTENTION', label: 'Needs attention' },
            { id: 'PENDING', label: 'Pending' },
            { id: 'APPROVED', label: 'Approved' },
          ].map(v => {
            const isActive = statusFilter === v.id;
            const count = v.id === 'ALL' ? tenantInvoices.length
              : v.id === 'ATTENTION' ? tenantInvoices.filter(i => ['REJECTED','FAILED'].includes(i.status)).length
              : v.id === 'PENDING' ? tenantInvoices.filter(i => ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(i.status)).length
              : tenantInvoices.filter(i => ['APPROVED','SIGNED'].includes(i.status)).length;
            return (
              <button
                key={v.id}
                onClick={() => setStatusFilter(v.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${isActive ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {v.label} <span className={isActive ? 'text-slate-300' : 'text-slate-400'}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3 font-sans">

          <OverlaySelect
            label="Type:"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'ALL', label: 'All Document Types' },
              { value: 'STANDARD', label: 'Standard Invoice' },
              { value: 'CREDIT_NOTE', label: 'Credit Note' },
              { value: 'DEBIT_NOTE', label: 'Debit Note' },
            ]}
          />

        </div>

      </div>

      {/* Invoices Master Table */}
      <div className="bg-white rounded-lg border border-slate-200/80 overflow-hidden shadow-sm font-sans">
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <FileText className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold tracking-tight">
              {activeTenant.name} Invoices Ledger ({filteredInvoices.length})
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {hasRetryable && (
              <button onClick={handleBulkRetry} disabled={isAnyPropagating} title={hasRetryable ? 'Retry pending — Bulk Send dulled until failures cleared (Send → Retry sequential)' : ''} className={`px-4 py-2 font-semibold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer shadow-sm transition-all font-sans disabled:opacity-40 disabled:cursor-not-allowed disabled:grayscale bg-amber-600 hover:bg-amber-700 text-white`}>
                <RotateCcw className={`w-3.5 h-3.5 ${isBulkRetrying?'animate-spin':''}`} />
                <span>{isBulkRetrying ? 'Retrying…' : `Retry Failed (${retryableBulk.length})`}</span>
              </button>
            )}
          </div>
        </div>

        {bulkMsg && (
          <div className={`mx-5 mt-4 p-3 rounded-lg border text-xs flex items-center gap-2 ${bulkMsg.type==='error' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-slate-50 text-slate-900 border-slate-200'}`}>
            {bulkMsg.type==='error' ? <AlertCircle className="w-4 h-4 text-rose-600" /> : <CheckCircle2 className="w-4 h-4 text-slate-900" />}
            <span className="flex-1">{bulkMsg.text}</span>
            <button onClick={()=>setBulkMsg(null)} className="text-xs font-semibold hover:underline cursor-pointer">Dismiss</button>
          </div>
        )}

        {(() => {
          const invalid = filteredInvoices.filter(inv => getInvoiceErrors(inv).length >0);
          if (invalid.length===0) return null;
          return (
            <div className="mx-5 mt-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs overflow-hidden">
              <button onClick={()=>setShowVerboseErrors(v=>!v)} className="w-full flex items-center justify-between p-3 text-left cursor-pointer hover:bg-amber-100/50">
                <span className="font-bold flex items-center gap-1"><AlertCircle className="w-4 h-4 text-amber-600" /> {invalid.length} invoice(s) need fixing</span>
                <span className="flex items-center gap-1 text-amber-700 font-semibold">{showVerboseErrors ? 'Hide' : 'Show'} <ChevronDown className={`w-3.5 h-3.5 transition ${showVerboseErrors?'rotate-180':''}`} /></span>
              </button>
              {showVerboseErrors && (
                <div className="px-3 pb-3">
                  <p className="text-[11px] text-amber-800 mb-1">Fix Customer TIN (10-14 alphanum), HS code, Qty/Price before Send — highlighted red below.</p>
                  <ul className="list-disc list-inside space-y-0.5 max-h-32 overflow-y-auto bg-white/60 rounded-lg p-2 border border-amber-100">
                    {invalid.map((inv:any)=><li key={inv.id}><span className="font-mono font-semibold">{inv.clientInvoiceNumber}</span> — {getInvoiceErrors(inv).join('; ')}</li>)}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}

        {isAnyPropagating && (
          <div className="mx-5 mt-3 p-3 rounded-lg border border-slate-300 bg-slate-600 text-white flex items-center gap-2.5 font-sans shadow-sm">
            <Clock className="w-4 h-4 animate-spin text-slate-200" />
            <span className="text-xs font-bold tracking-tight">Propagating to CittaEFS…</span>
            <span className="px-2 py-0.5 bg-white/20 rounded-full text-[11px] font-mono font-bold">{elapsedSec}s</span>
          </div>
        )}

        {filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-sans">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-800">No invoices match your filter criteria.</p>
            <p className="text-xs text-slate-500 mt-1">Try clearing filters or transmitting a test transaction.</p>
          </div>
        ) : (
          <>
            {/* Mobile-first: stacked cards on <lg, table on >=lg */}
            <div className={`lg:hidden space-y-3 p-3 ${isAnyPropagating ? 'opacity-60 blur-[0.5px] pointer-events-none select-none' : ''}`}>
              {filteredInvoices.map((inv:any) => {
                const errs = getInvoiceErrors(inv);
                const hasErr = errs.length>0;
                return (
                  <div key={`m-${inv.id}`} className={`rounded-lg border p-4 space-y-3 bg-white shadow-sm ${hasErr ? 'border-rose-200 bg-rose-50/20' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-bold text-slate-900 text-sm">{inv.clientInvoiceNumber}</div>
                        <div className="text-[11px] text-slate-500">{inv.issueDate} • {inv.invoiceType} • {inv.invoiceKind}</div>
                        <div className="text-xs font-medium text-slate-800 mt-1 truncate max-w-[200px]">{inv.customerName}</div>
                        <div className="text-[11px] font-mono text-slate-500">TIN: {inv.customerTin || 'N/A'}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <StatusBadge tone={statusTone(inv.status)}>{inv.status}</StatusBadge>
                        <span className="text-xs font-bold text-slate-900">NGN {inv.grandTotal.toLocaleString()}</span>
                        <span className="text-[11px] text-slate-500">VAT NGN {inv.totalVat.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-slate-600"><span className="truncate">{inv.irn ? inv.irn.slice(0,22)+'…' : 'Pending Stamp'}</span>{inv.irn && <button onClick={()=>setQrModalInvoice(inv)} className="p-1 text-slate-400 hover:text-emerald-700"><QrCode className="w-4 h-4" /></button>}<button onClick={()=>setExpandedInvoiceId(inv.id)} className="ml-auto px-2 py-1 bg-slate-900 text-white rounded-lg text-[11px]">Details</button></div>
                    {hasErr && <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 leading-relaxed">{errs[0]} {errs.length>1 && <button onClick={()=>setShowVerboseErrors(true)} className="underline font-semibold">+{errs.length-1} more</button>}</div>}
                  </div>
                );
              })}
            </div>
            <div className={`hidden lg:block overflow-x-auto transition-all scroll-smooth ${isAnyPropagating ? 'opacity-60 blur-[0.5px] pointer-events-none select-none' : ''}`}>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                  <th className="py-3 px-3"></th>
                  <th className="py-3 px-4">Client Inv #</th>
                  <th className="py-3 px-4">Type & Kind</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Grand Total</th>
                  <th className="py-3 px-4">NRS Gateway IRN</th>
                  <th className="py-3 px-4">Compliance Status</th>
                  <th className="py-3 px-4">Ledger Writeback</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredInvoices.map((inv) => {
                  const isExpanded = expandedInvoiceId === inv.id;
                  const errs = getInvoiceErrors(inv);
                  const hasErr = errs.length>0;

                  return (
                    <tr key={inv.id} className={`hover:bg-slate-50/80 transition-colors ${isExpanded ? 'bg-emerald-50/30' : ''} ${hasErr ? 'bg-rose-50/40 ring-1 ring-rose-200' : ''}`}>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                          className="text-slate-400 hover:text-emerald-700 transition-colors cursor-pointer p-1"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {inv.clientInvoiceNumber}
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">{inv.issueDate}</div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col space-y-1">
                          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full w-max bg-slate-100 text-slate-700 border border-slate-200`}>
                            {inv.invoiceType}
                          </span>
                          <span className="text-[11px] text-slate-400">Kind: {inv.invoiceKind}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 max-w-[170px]">
                        <div className="font-medium text-slate-900 truncate" title={inv.customerName}>
                          {inv.customerName}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          TIN: {inv.customerTin || 'N/A (B2C)'}
                        </div>
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-900">
                        NGN {inv.grandTotal.toLocaleString()}
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">VAT: NGN {inv.totalVat.toLocaleString()}</div>
                      </td>

                      <td className="py-3 px-4 font-mono text-[11px]">
                        {inv.irn ? (
                          <div className="flex items-center space-x-1.5 text-slate-800 font-medium">
                            <span className="truncate max-w-[140px]" title={inv.irn}>{inv.irn}</span>
                            <button
                              onClick={() => setQrModalInvoice(inv)}
                              className="text-slate-400 hover:text-emerald-700 p-0.5 transition-colors cursor-pointer"
                              title="Show Official QR Code"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-amber-600 font-medium text-xs">Pending Stamp</span>
                        )}
                        {inv.originalIrn && (
                          <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5" title={`Linked Original IRN: ${inv.originalIrn}`}>
                            Ref: {inv.originalIrn.substring(0, 14)}...
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge tone={statusTone(inv.status)}>
                          {inv.status === 'SIGNED' || inv.status === 'APPROVED' ? (
                            <CheckCircle2 className="w-3 h-3 mr-1 text-white" />
                          ) : inv.status === 'REJECTED' ? (
                            <AlertCircle className="w-3 h-3 mr-1 text-white" />
                          ) : null}
                          {inv.status}
                        </StatusBadge>
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge tone={writebackTone(inv.ledgerWritebackStatus)}>
                          {inv.ledgerWritebackStatus === 'SYNCED' ? 'Synced to ERP' : 'Pending Writeback'}
                        </StatusBadge>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setExpandedInvoiceId(inv.id)}
                          className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Per-row overlay for line items — purple, row-specific */}
      {expandedInvoiceId && (() => {
        const inv = tenantInvoices.find(i => i.id === expandedInvoiceId);
        if (!inv) return null;
        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setExpandedInvoiceId(null)}>
            <div className="bg-white w-full max-w-3xl rounded-lg border border-slate-200 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-900" />
                  {inv.clientInvoiceNumber} — {inv.lineItems.length} item(s) • {inv.customerName}
                </h4>
                <button onClick={() => setExpandedInvoiceId(null)} className="p-1.5 hover:bg-white rounded-lg text-slate-500 hover:text-slate-700 border border-transparent hover:border-slate-200 cursor-pointer"><XCircle className="w-4 h-4" /></button>
              </div>
              <div className="overflow-y-auto p-4 space-y-3">
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                      <tr>
                        <th className="py-2 px-3">SKU</th>
                        <th className="py-2 px-3">Description</th>
                        <th className="py-2 px-3 text-center">Qty</th>
                        <th className="py-2 px-3 text-right">Unit Price</th>
                        <th className="py-2 px-3 text-right">Taxable</th>
                        <th className="py-2 px-3 text-center">VAT%</th>
                        <th className="py-2 px-3">HS Code</th>
                        <th className="py-2 px-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {inv.lineItems.map((li) => (
                        <tr key={li.id} className="hover:bg-slate-50/30">
                          <td className="py-2 px-3 font-mono font-semibold text-slate-900">{li.itemCode}</td>
                          <td className="py-2 px-3 text-slate-700">{li.description}</td>
                          <td className="py-2 px-3 text-center">{li.quantity}</td>
                          <td className="py-2 px-3 text-right">NGN {li.unitPrice.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right">NGN {li.taxableAmount.toLocaleString()}</td>
                          <td className="py-2 px-3 text-center">{li.vatRate}%</td>
                          <td className="py-2 px-3 font-mono text-[11px]"><StatusBadge tone={li.hsOrServiceCode==='UNMAPPED' ? 'fail' : 'neutral'}>{li.hsOrServiceCode}</StatusBadge></td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">NGN {li.totalAmount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {inv.errorMessage && <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-lg"><strong>Pre-flight:</strong> {inv.errorMessage}</div>}
                <div className="flex justify-end gap-2 flex-wrap">
                  <button onClick={() => setExpandedInvoiceId(null)} className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer">Close</button>
                  {(inv.status !== 'APPROVED' && inv.status !== 'SIGNED') && (
                    <button
                      onClick={() => {
                        setEditError(null);
                        const copy = JSON.parse(JSON.stringify(inv));
                        const master = tenantCustomers.find((c:any)=> c.clientCustomerCode===copy.customerCode || c.clientSystemCustId===copy.customerCode);
                        if ((!copy.customerTin || copy.customerTin==='N/A') && master?.tin) copy.customerTin = master.tin;
                        if ((!copy.customerTin || copy.customerTin==='N/A') && master?.taxId) copy.customerTin = master.taxId;
                        if (!copy.customerName && master?.name) copy.customerName = master.name;
                        copy.lineItems = (copy.lineItems||[]).map((li:any)=>{ const m = tenantItems.find((x:any)=> x.clientSku===li.itemCode); if ((!li.hsOrServiceCode || li.hsOrServiceCode==='UNMAPPED') && m?.hsOrServiceCode) return {...li, hsOrServiceCode: m.hsOrServiceCode, vatRate: li.vatRate ?? m.defaultVatRate}; return li; });
                        setExpandedInvoiceId(null);
                        setEditingInvoice(copy);
                      }}
                      className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  {(inv.status !== 'APPROVED' && inv.status !== 'SIGNED') && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete invoice ${inv.clientInvoiceNumber}? This cannot be undone.`)) return;
                        try { await deleteInvoice(inv.id); setExpandedInvoiceId(null); } catch(e:any){ setBulkMsg({type:'error', text:e.message}); }
                      }}
                      className="px-4 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  )}
                  {(inv.status === 'REJECTED' || inv.status === 'FAILED') && <button disabled={isAnyPropagating} onClick={async()=>{ setExpandedSending(true); try{ await retryInvoice(inv.id); setBulkMsg({type:'success', text:`Retry queued for ${inv.clientInvoiceNumber}`}); setExpandedInvoiceId(null);} catch(e:any){ setBulkMsg({type:'error', text:e.message});} finally{ setExpandedSending(false);}}} className={`px-4 py-2 text-white rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5 font-sans disabled:opacity-40 disabled:cursor-not-allowed disabled:grayscale ${retryingId===inv.id ? 'bg-amber-400 cursor-wait' : 'bg-amber-600 hover:bg-amber-700'}`}><RotateCcw className={`w-3.5 h-3.5 ${retryingId===inv.id?'animate-spin':''}`} /> {retryingId===inv.id?'Retrying…':'Retry — re-queue to CittaEFS'}</button>}
                  {(inv.status !== 'APPROVED' && inv.status !== 'SIGNED' && inv.status !== 'REJECTED' && inv.status !== 'FAILED') && <button disabled={isAnyPropagating} onClick={async () => { if(expandedSending) return; const errs=getInvoiceErrors(inv); if(errs.length>0){ setBulkMsg({type:'error', text:`${inv.clientInvoiceNumber}: ${errs.join('; ')} — fix highlighted fields.`}); toastGlobal('error','Fix before sending', errs[0]); return; } setExpandedSending(true); toastGlobal('info',`Queuing ${inv.clientInvoiceNumber}…`,'Idempotent'); try { const tin = resolveTin(inv); await transmitInvoice({ clientInvoiceNumber: inv.clientInvoiceNumber, invoiceKind: inv.invoiceKind, invoiceType: inv.invoiceType, issueDate: inv.issueDate, customerCode: inv.customerCode, customerName: inv.customerName, customerTin: tin, lineItems: inv.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, hsOrServiceCode: li.hsOrServiceCode, vatRate: li.vatRate })) }); setBulkMsg({type:'success', text:`Queued ${inv.clientInvoiceNumber} for NRS stamping.`}); setExpandedInvoiceId(null); } catch(e:any){ setBulkMsg({type:'error', text:e.message}); } finally{ setExpandedSending(false);} }} className={`px-4 py-2 text-white rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5 font-sans disabled:opacity-40 disabled:cursor-not-allowed disabled:grayscale ${expandedSending ? 'bg-slate-400 cursor-wait opacity-80' : 'bg-slate-600 hover:bg-slate-700'}`}><Send className={`w-3.5 h-3.5 ${expandedSending ? 'animate-pulse' : ''}`} /> {expandedSending ? 'Queuing…' : 'Send to CittaEFS'}</button>}
                  {(inv.status === 'APPROVED' || inv.status === 'SIGNED') && <span className="px-3 py-2 bg-slate-50 text-slate-900 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Process — Approved</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Invoice Overlay */}
      {editingInvoice && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setEditError(null); setEditingInvoice(null); }}>
          <div className="bg-white w-full max-w-3xl rounded-lg border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Pencil className="w-4 h-4 text-slate-900" /> Edit Invoice {editingInvoice.clientInvoiceNumber}</h4>
              <button onClick={() => { setEditError(null); setEditingInvoice(null); }} className="p-1.5 hover:bg-white rounded-lg text-slate-500 hover:text-slate-700 border border-transparent hover:border-slate-200 cursor-pointer"><XCircle className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto p-6 space-y-4">
              {editError && (
                <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="font-bold">Please fix the following before saving:</p>
                      <ul className="list-disc list-inside space-y-0.5 whitespace-pre-wrap">
                        {editError.split('; ').map((e,i)=><li key={i}>{e.replace(/^Fix:\s*/,'').replace(/^•\s*/,'')}</li>)}
                      </ul>
                    </div>
                    <button onClick={()=>setEditError(null)} className="text-rose-600 hover:text-rose-800 font-semibold cursor-pointer shrink-0">Dismiss</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Invoice # *</label>
                  <input value={editingInvoice.clientInvoiceNumber} onChange={e=>{ setEditError(null); setEditingInvoice({...editingInvoice, clientInvoiceNumber: e.target.value}); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Issue Date *</label>
                  <input type="date" value={editingInvoice.issueDate ? new Date(editingInvoice.issueDate).toISOString().slice(0,10) : ''} onChange={e=>{ setEditError(null); setEditingInvoice({...editingInvoice, issueDate: e.target.value}); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Invoice Kind *</label>
                  <select value={editingInvoice.invoiceKind || 'B2B'} onChange={e=>{ setEditError(null); setEditingInvoice({...editingInvoice, invoiceKind: e.target.value}); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:border-slate-500 focus:ring-1 focus:ring-slate-500">
                    <option value="B2B">B2B</option><option value="B2C">B2C</option><option value="B2G">B2G</option><option value="EXPORT">EXPORT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Invoice Type *</label>
                  <select value={editingInvoice.invoiceType || 'STANDARD'} onChange={e=>{ setEditError(null); setEditingInvoice({...editingInvoice, invoiceType: e.target.value}); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:border-slate-500 focus:ring-1 focus:ring-slate-500">
                    <option value="STANDARD">STANDARD</option><option value="CREDIT_NOTE">CREDIT_NOTE</option><option value="DEBIT_NOTE">DEBIT_NOTE</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Customer — pick from the Gateway (auto-fills TIN & name, no manual typing)</label>
                  <select value={editingInvoice.customerCode || ''} onChange={e=>{ setEditError(null); const code=e.target.value; const m = tenantCustomers.find((c:any)=> c.clientCustomerCode===code || c.clientSystemCustId===code); setEditingInvoice({...editingInvoice, customerCode: code, customerName: m?.name || editingInvoice.customerName, customerTin: m?.tin || m?.taxId || editingInvoice.customerTin }); }} className="w-full px-3 py-2 border border-slate-200 bg-slate-50/40 rounded-lg text-xs font-medium focus:border-slate-500 focus:ring-1 focus:ring-slate-500">
                    <option value="">— Select customer from the Gateway ({tenantCustomers.length} available) —</option>
                    {tenantCustomers.map((c:any)=>(
                      <option key={c.id} value={c.clientCustomerCode || c.clientSystemCustId}>{c.name} — {c.clientCustomerCode || c.clientSystemCustId} — TIN:{c.tin || c.taxId || '—'}</option>
                    ))}
                    <option value={editingInvoice.customerCode}>— Keep current: {editingInvoice.customerCode} —</option>
                  </select>
                  {tenantCustomers.length===0 && <p className="text-[11px] text-amber-600 mt-1">No customers in the Gateway for this tenant — add in Customer Registrations first.</p>}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Customer Name * (pulled from the Gateway)</label>
                  <input value={editingInvoice.customerName || ''} onChange={e=>{ setEditError(null); setEditingInvoice({...editingInvoice, customerName: e.target.value}); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:border-slate-500 focus:ring-1 focus:ring-slate-500" placeholder="Auto-filled when you pick customer above" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Customer TIN {editingInvoice.invoiceKind==='B2B' || editingInvoice.invoiceKind==='B2G' ? '*' : '(B2C optional)'} — pulled from the Gateway</label>
                  <input value={editingInvoice.customerTin || resolveTin(editingInvoice) || ''} onChange={e=>{ setEditError(null); setEditingInvoice({...editingInvoice, customerTin: e.target.value}); }} placeholder="Auto-filled from customer records" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
                  {resolveTin(editingInvoice) && !editingInvoice.customerTin && <p className="text-[10px] text-emerald-700 mt-1">✓ Pulled TIN {resolveTin(editingInvoice)} from the Gateway — will be saved</p>}
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Customer Code (from the Gateway)</label>
                  <input value={editingInvoice.customerCode || ''} onChange={e=>{ setEditError(null); setEditingInvoice({...editingInvoice, customerCode: e.target.value}); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-slate-50 focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600">Line Items ({editingInvoice.lineItems?.length || 0}) — pulled from the Gateway: pick SKU from Items dictionary</span>
                  <button onClick={()=>{ setEditError(null); const newLine={ itemCode: tenantItems[0]?.clientSku || `SKU-${Date.now().toString().slice(-4)}`, description: tenantItems[0]?.name || 'New line', quantity:1, unitPrice:1000, hsOrServiceCode: tenantItems[0]?.hsOrServiceCode || 'UNMAPPED', vatRate: tenantItems[0]?.defaultVatRate ?? 7.5 }; setEditingInvoice({...editingInvoice, lineItems:[...(editingInvoice.lineItems||[]), newLine]}); }} className="px-2 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1"><Plus className="w-3 h-3" /> Add line (from Gateway)</button>
                </div>
                <div className="mt-2 space-y-2 max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50/50">
                  {(editingInvoice.lineItems || []).map((li:any, idx:number)=>(
                    <div key={idx} className="grid grid-cols-12 gap-1.5 bg-white p-2 rounded-lg border border-slate-200 items-end">
                      <div className="col-span-3">
                        <label className="block text-[9px] font-semibold text-slate-500 mb-1">SKU — from the Gateway</label>
                        <select value={li.itemCode} onChange={e=>{ setEditError(null); const code=e.target.value; const m=tenantItems.find((x:any)=> x.clientSku===code); const n=editingInvoice.lineItems.map((x:any,i:number)=> i===idx ? {...x, itemCode:code, description: m?.name || x.description, hsOrServiceCode: m?.hsOrServiceCode || x.hsOrServiceCode, vatRate: m?.defaultVatRate ?? x.vatRate} : {...x}); setEditingInvoice({...editingInvoice, lineItems:n}); }} className="w-full px-2 py-1.5 border border-slate-200 bg-slate-50/30 rounded text-xs font-mono">
                          {tenantItems.length>0 ? tenantItems.map((m:any)=>(<option key={m.id} value={m.clientSku}>{m.clientSku} — {m.name} ({m.hsOrServiceCode})</option>)) : <option value={li.itemCode}>{li.itemCode} (no gateway items — see Items tab)</option>}
                          {!tenantItems.find((x:any)=>x.clientSku===li.itemCode) && <option value={li.itemCode}>{li.itemCode} — current</option>}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[9px] font-semibold text-slate-500 mb-1">Description</label>
                        <input value={li.description} onChange={e=>{ setEditError(null); const n=editingInvoice.lineItems.map((x:any,i:number)=> i===idx ? {...x, description:e.target.value} : {...x}); setEditingInvoice({...editingInvoice, lineItems:n}); }} placeholder="Description" className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs" />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[9px] font-semibold text-slate-500 mb-1">Qty</label>
                        <input type="number" value={li.quantity} onChange={e=>{ setEditError(null); const n=editingInvoice.lineItems.map((x:any,i:number)=> i===idx ? {...x, quantity: e.target.value==='' ? 0 : Number(e.target.value)} : {...x}); setEditingInvoice({...editingInvoice, lineItems:n}); }} placeholder="Qty" className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs text-right" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[9px] font-semibold text-slate-500 mb-1">Unit Price</label>
                        <input type="number" value={li.unitPrice} onChange={e=>{ setEditError(null); const n=editingInvoice.lineItems.map((x:any,i:number)=> i===idx ? {...x, unitPrice: e.target.value==='' ? 0 : Number(e.target.value)} : {...x}); setEditingInvoice({...editingInvoice, lineItems:n}); }} placeholder="Price" className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs text-right" />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-[9px] font-semibold text-slate-500 mb-1">VAT%</label>
                        <input type="number" step="0.1" value={li.vatRate ?? ''} onChange={e=>{ setEditError(null); const n=editingInvoice.lineItems.map((x:any,i:number)=> i===idx ? {...x, vatRate: e.target.value==='' ? 0 : Number(e.target.value)} : {...x}); setEditingInvoice({...editingInvoice, lineItems:n}); }} placeholder="7.5" className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs text-right" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[9px] font-semibold text-slate-500 mb-1">HS/Service Code</label>
                        <CittaCodeSelect
                          value={li.hsOrServiceCode || ''}
                          onChange={(code)=>{ setEditError(null); const n=editingInvoice.lineItems.map((x:any,i:number)=> i===idx ? {...x, hsOrServiceCode:code} : {...x}); setEditingInvoice({...editingInvoice, lineItems:n}); }}
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-center pb-0.5">
                        <button onClick={()=>{ const n=editingInvoice.lineItems.filter((_:any,i:number)=>i!==idx); if(n.length===0) { setEditError('At least one line required'); return; } setEditingInvoice({...editingInvoice, lineItems:n}); }} className="p-1.5 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 rounded-lg"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                {tenantItems.length===0 && <p className="text-[11px] text-amber-600 mt-1">No items in the Gateway — add mappings in the Items tab; HS codes fall back to entry above.</p>}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={()=>{ setEditError(null); setEditingInvoice(null); }} className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer">Cancel</button>
                <button
                  onClick={async ()=>{
                    const errs = getInvoiceErrors(editingInvoice);
                    if (errs.length>0) { setEditError(`Fix: ${errs.join('; ')}`); return; }
                    setEditError(null);
                    setEditSaving(true);
                    try {
                      console.log('[Edit] Saving invoice', editingInvoice.id, editingInvoice.clientInvoiceNumber);
                      await updateInvoice(editingInvoice.id, {
                        clientInvoiceNumber: editingInvoice.clientInvoiceNumber,
                        issueDate: editingInvoice.issueDate,
                        customerCode: editingInvoice.customerCode,
                        customerName: editingInvoice.customerName,
                        customerTin: editingInvoice.customerTin,
                        lineItems: editingInvoice.lineItems,
                      });
                      setBulkMsg({type:'success', text:`Invoice ${editingInvoice.clientInvoiceNumber} updated.`});
                      setEditingInvoice(null);
                      setEditError(null);
                    } catch(e:any){
                      console.error('[Edit] Save failed:', e);
                      setEditError(e.message || 'Save failed — check console');
                    }
                    finally { setEditSaving(false); }
                  }}
                  disabled={editSaving || isAnyPropagating}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:grayscale text-white rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5 font-sans"
                >
                  <Save className="w-3.5 h-3.5" /> {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Official Verification Modal */}
      {qrModalInvoice && (
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-slate-900 max-w-md w-full p-6 text-slate-900 text-center space-y-4 font-mono">
            <div className="w-12 h-12 bg-amber-400 border-2 border-slate-900 text-slate-950 flex items-center justify-center mx-auto">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 uppercase">Official NRS Portal Stamp</h3>
              <p className="text-xs text-slate-600 mt-1">Regulatory Fiscal Receipt Verification</p>
            </div>

            <div className="bg-slate-100 p-4 border-2 border-slate-900 inline-block">
              {/* Simulated QR Visual */}
              <div className="w-40 h-40 bg-slate-900 p-2 border-2 border-slate-900 mx-auto flex items-center justify-center text-white text-[10px] font-mono leading-tight">
                <div className="grid grid-cols-6 gap-1 w-full h-full p-1 bg-white">
                  {Array.from({ length: 36 }).map((_, i) => (
                    <div
                      key={i}
                      className={`${i % 2 === 0 || i % 5 === 0 ? 'bg-slate-900' : 'bg-white'}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="text-xs space-y-1 bg-slate-100 p-3 border-2 border-slate-900">
              <p className="text-slate-600 font-bold uppercase">Official IRN Code:</p>
              <p className="font-mono font-black text-slate-900 text-xs select-all">{qrModalInvoice.irn}</p>
              <p className="text-[10px] text-slate-500 mt-1">Stamped: {qrModalInvoice.nrsStampTimestamp}</p>
            </div>

            <div className="flex justify-center space-x-3 pt-2">
              <a
                href={qrModalInvoice.verificationLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-black uppercase border-2 border-slate-900"
              >
                <span>Verify on NRS Portal</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => setQrModalInvoice(null)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
