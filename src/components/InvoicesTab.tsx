import { useState } from 'react';
import { useHub } from '../lib/store';
import { Invoice, InvoiceType, InvoiceKind, InvoiceStatus } from '../types';
import {
  FileText,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  QrCode,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RotateCcw,
  FileCode,
  PlusCircle,
  DollarSign,
  ArrowLeftRight,
  Send,
  Eye
} from 'lucide-react';
import { OverlaySelect } from './ui/OverlaySelect';

export function InvoicesTab() {
  const { invoices, activeTenant, cancelInvoice, transmitInvoice, currentUser, bulkTransmitInvoices } = useHub() as any;

  // Both Admin and Operator have access here.

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  // Modals / Drawers
  const [selectedPayloadInvoice, setSelectedPayloadInvoice] = useState<Invoice | null>(null);
  const [qrModalInvoice, setQrModalInvoice] = useState<Invoice | null>(null);
  const [creditNoteModalInvoice, setCreditNoteModalInvoice] = useState<Invoice | null>(null);

  // Credit Note form fields
  const [cnAmount, setCnAmount] = useState<number>(10000);
  const [cnReason, setCnReason] = useState<string>('Product return & damaged goods adjustment');

  const tenantInvoices = invoices.filter(inv => inv.tenantId === activeTenant.id);

  const filteredInvoices = tenantInvoices.filter(inv => {
    const matchesSearch =
      inv.clientInvoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.irn && inv.irn.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || inv.status === statusFilter;
    const matchesType = typeFilter === 'ALL' || inv.invoiceType === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  const handleIssueCreditNote = async () => {
    if (!creditNoteModalInvoice) return;

    const payload = {
      tenantId: activeTenant.id,
      clientInvoiceNumber: `CN-${creditNoteModalInvoice.clientInvoiceNumber}`,
      invoiceType: 'CREDIT_NOTE',
      invoiceKind: creditNoteModalInvoice.invoiceKind,
      originalIrn: creditNoteModalInvoice.irn,
      issueDate: new Date().toISOString().substring(0, 10),
      customerCode: creditNoteModalInvoice.customerCode,
      customerName: creditNoteModalInvoice.customerName,
      customerTin: creditNoteModalInvoice.customerTin,
      lineItems: [
        {
          itemCode: creditNoteModalInvoice.lineItems[0]?.itemCode || 'SKU-ADJUSTMENT',
          description: `Credit Note Reversal: ${cnReason}`,
          quantity: 1,
          unitPrice: cnAmount,
          discountAmount: 0,
          vatRate: creditNoteModalInvoice.lineItems[0]?.vatRate ?? (activeTenant as any)?.defaultVatRate ?? 7.5,
          hsOrServiceCode: creditNoteModalInvoice.lineItems[0]?.hsOrServiceCode || 'SRV-7414.00'
        }
      ]
    };

    await transmitInvoice(payload);
    setCreditNoteModalInvoice(null);
  };

  const handleCancelInvoice = async (inv: Invoice) => {
    if (confirm(`Are you sure you want to trigger regulatory revocation for IRN ${inv.irn || inv.clientInvoiceNumber}?`)) {
      await cancelInvoice(inv.id, 'User requested revocation via Control Panel');
    }
  };

  const [isBulkSending, setIsBulkSending] = useState(false);
  const pendingBulk = filteredInvoices.filter(inv => inv.status === 'PENDING_NRS_STAMP' || inv.status === 'QUEUED' || (inv.status as any) === 'PENDING');
  const handleBulkSend = async () => {
    if (pendingBulk.length === 0) { alert('No pending invoices to send.'); return; }
    if (!confirm(`Bulk send ${pendingBulk.length} pending invoice(s) to CittaEFS gateway? This uses POST /api/integration/gen/invoices/bulk (single bulk request).`)) return;
    setIsBulkSending(true);
    try {
      const payloads = pendingBulk.map(inv => ({
        clientInvoiceNumber: inv.clientInvoiceNumber,
        invoiceKind: inv.invoiceKind || 'B2B',
        invoiceType: inv.invoiceType || 'STANDARD',
        issueDate: inv.issueDate || new Date().toISOString().substring(0, 10),
        customerCode: inv.customerCode || 'CUST-001',
        customerName: inv.customerName,
        customerTin: inv.customerTin,
        lineItems: inv.lineItems?.length ? inv.lineItems.map((li: any) => ({
          itemCode: li.itemCode,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          hsOrServiceCode: li.hsOrServiceCode,
          vatRate: li.vatRate,
        })) : [{ itemCode: 'SKU-001', description: 'Item', quantity: 1, unitPrice: inv.grandTotal || 5000, hsOrServiceCode: 'HS-8471.30', vatRate: 7.5 }]
      }));
      const res = await bulkTransmitInvoices(payloads);
      alert(`Bulk send queued: ${res.successCount} succeeded, ${res.failedCount} failed. ${res.message || ''}`);
    } catch (e: any) {
      alert(e.message || 'Bulk send failed');
    } finally { setIsBulkSending(false); }
  };

  return (
    <div className="space-y-6">

      {/* Top Action Bar & Filters */}
      <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 font-sans">

        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search Invoice #, IRN, or Customer Name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3 font-sans">

          <OverlaySelect
            label="Status:"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'SIGNED', label: 'SIGNED (NRS Stamped)' },
              { value: 'APPROVED', label: 'APPROVED' },
              { value: 'PENDING_NRS_STAMP', label: 'PENDING STAMP' },
              { value: 'REJECTED', label: 'REJECTED / ERROR' },
              { value: 'CANCELLED', label: 'CANCELLED' },
            ]}
          />
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
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm font-sans">
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <FileText className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold tracking-tight">
              {activeTenant.name} Invoices Ledger ({filteredInvoices.length})
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300 hidden sm:inline">
              Format: <strong className="text-violet-300">{activeTenant.platformType}</strong>
            </span>
            <button onClick={handleBulkSend} disabled={isBulkSending || pendingBulk.length===0} className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer">
              <Send className="w-3.5 h-3.5" />
              <span>{isBulkSending ? 'Sending…' : `Bulk Send to CittaEFS (${pendingBulk.length})`}</span>
            </button>
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-sans">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-800">No invoices match your filter criteria.</p>
            <p className="text-xs text-slate-500 mt-1">Try clearing filters or transmitting a test transaction.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
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

                  return (
                    <tr key={inv.id} className={`hover:bg-slate-50/80 transition-colors ${isExpanded ? 'bg-indigo-50/30' : ''}`}>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                          className="text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer p-1"
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
                          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full w-max ${inv.invoiceType === 'CREDIT_NOTE' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                              inv.invoiceType === 'DEBIT_NOTE' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                'bg-slate-100 text-slate-700'
                            }`}>
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
                              className="text-slate-400 hover:text-indigo-600 p-0.5 transition-colors cursor-pointer"
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
                        <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-semibold rounded-full ${inv.status === 'SIGNED' || inv.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            inv.status === 'PENDING_NRS_STAMP' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              inv.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                                'bg-slate-100 text-slate-700'
                          }`}>
                          {inv.status === 'SIGNED' || inv.status === 'APPROVED' ? (
                            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                          ) : inv.status === 'REJECTED' ? (
                            <AlertCircle className="w-3 h-3 mr-1 text-rose-600" />
                          ) : null}
                          {inv.status}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-semibold rounded-full ${inv.ledgerWritebackStatus === 'SYNCED' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                          {inv.ledgerWritebackStatus === 'SYNCED' ? 'Synced to ERP' : 'Pending Writeback'}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">

                          {/* Inspect CittaEFS JSON Payload */}
                          <button
                            onClick={() => setSelectedPayloadInvoice(inv)}
                            className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-md border border-slate-200 transition-colors cursor-pointer"
                            title="Inspect CittaEFS JSON Payload"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                          </button>

                          {/* Issue Credit Note Button */}
                          {true && (inv.status === 'SIGNED' || inv.status === 'APPROVED') && inv.invoiceType === 'STANDARD' && (
                            <button
                              onClick={() => setCreditNoteModalInvoice(inv)}
                              className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-md border border-amber-200 transition-colors cursor-pointer"
                              title="Issue Linked Credit Note"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Cancel Invoice */}
                          {true && inv.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleCancelInvoice(inv)}
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-md border border-rose-200 transition-colors cursor-pointer"
                              title="Revoke / Cancel Invoice"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}

                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-row overlay for line items — purple, row-specific */}
      {expandedInvoiceId && (() => {
        const inv = tenantInvoices.find(i => i.id === expandedInvoiceId);
        if (!inv) return null;
        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setExpandedInvoiceId(null)}>
            <div className="bg-white w-full max-w-3xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-violet-50">
                <h4 className="text-sm font-bold text-violet-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-violet-600" />
                  {inv.clientInvoiceNumber} — {inv.lineItems.length} item(s) • {inv.customerName}
                </h4>
                <button onClick={() => setExpandedInvoiceId(null)} className="p-1.5 hover:bg-white rounded-lg text-slate-500 hover:text-slate-700 border border-transparent hover:border-slate-200 cursor-pointer"><XCircle className="w-4 h-4" /></button>
              </div>
              <div className="overflow-y-auto p-4 space-y-3">
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
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
                        <tr key={li.id} className="hover:bg-violet-50/30">
                          <td className="py-2 px-3 font-mono font-semibold text-violet-700">{li.itemCode}</td>
                          <td className="py-2 px-3 text-slate-700">{li.description}</td>
                          <td className="py-2 px-3 text-center">{li.quantity}</td>
                          <td className="py-2 px-3 text-right">NGN {li.unitPrice.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right">NGN {li.taxableAmount.toLocaleString()}</td>
                          <td className="py-2 px-3 text-center">{li.vatRate}%</td>
                          <td className="py-2 px-3 font-mono text-[11px]"><span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${li.hsOrServiceCode==='UNMAPPED' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>{li.hsOrServiceCode}</span></td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">NGN {li.totalAmount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {inv.errorMessage && <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-xl"><strong>Pre-flight:</strong> {inv.errorMessage}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setExpandedInvoiceId(null)} className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer">Close</button>
                  {(inv.status === 'PENDING_NRS_STAMP' || (inv.status as any)==='PENDING') && <button onClick={async () => { await transmitInvoice({ clientInvoiceNumber: inv.clientInvoiceNumber, invoiceKind: inv.invoiceKind, invoiceType: inv.invoiceType, issueDate: inv.issueDate, customerCode: inv.customerCode, customerName: inv.customerName, customerTin: inv.customerTin, lineItems: inv.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, hsOrServiceCode: li.hsOrServiceCode, vatRate: li.vatRate })) }); setExpandedInvoiceId(null); }} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Send to CittaEFS</button>}
                  {(inv.status === 'APPROVED' || inv.status === 'SIGNED') && <span className="px-3 py-2 bg-violet-50 text-violet-700 border border-violet-200 rounded-lg text-xs font-semibold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Process — Approved</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 1: CittaEFS Raw JSON Payload Viewer */}
      {selectedPayloadInvoice && (
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-4 border-slate-900 max-w-2xl w-full p-5 text-white font-mono">
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-800">
              <h3 className="text-sm font-black text-amber-400 uppercase flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-400" />
                Raw CittaEFS JSON Payload ({selectedPayloadInvoice.clientInvoiceNumber})
              </h3>
              <button
                onClick={() => setSelectedPayloadInvoice(null)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer font-black"
              >
                [X]
              </button>
            </div>
            <p className="text-xs text-slate-400 my-2">
              Exact JSON schema dispatched to CittaEFS API endpoint <code className="bg-slate-800 px-1 py-0.5 text-amber-400">POST /api/integration/gen/invoices</code>
            </p>
            <pre className="bg-slate-950 p-4 border-2 border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-96">
              {JSON.stringify(selectedPayloadInvoice, null, 2)}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setSelectedPayloadInvoice(null)}
                className="px-4 py-1.5 bg-amber-400 text-slate-950 hover:bg-amber-300 text-xs font-black uppercase cursor-pointer border border-slate-900"
              >
                Done Inspecting
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: QR Code Official Verification Modal */}
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

      {/* MODAL 3: Credit Note Linked Issuer */}
      {creditNoteModalInvoice && (
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-slate-900 max-w-lg w-full p-6 text-slate-900 space-y-4 font-mono">
            <div className="flex items-center justify-between pb-2 border-b-2 border-slate-900">
              <h3 className="text-base font-black text-slate-900 uppercase flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-500" />
                Issue Linked Credit Note
              </h3>
              <button
                onClick={() => setCreditNoteModalInvoice(null)}
                className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer font-black"
              >
                [CANCEL]
              </button>
            </div>

            <div className="text-xs bg-amber-100 p-3 border-2 border-slate-900 text-slate-950 space-y-1">
              <p>Original Invoice #: <strong>{creditNoteModalInvoice.clientInvoiceNumber}</strong></p>
              <p>Original IRN: <strong className="font-mono">{creditNoteModalInvoice.irn}</strong></p>
              <p>Customer: <strong>{creditNoteModalInvoice.customerName}</strong></p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Credit Adjustment Amount (NGN)
                </label>
                <input
                  type="number"
                  value={cnAmount}
                  onChange={(e) => setCnAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-black text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Reason for Fiscal Adjustment
                </label>
                <textarea
                  rows={2}
                  value={cnReason}
                  onChange={(e) => setCnReason(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs text-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end space-x-2">
              <button
                onClick={() => setCreditNoteModalInvoice(null)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleIssueCreditNote}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
              >
                Transmit Credit Note Payload
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
