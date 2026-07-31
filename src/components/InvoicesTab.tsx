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

export function InvoicesTab() {
  const { invoices, activeTenant, cancelInvoice, transmitInvoice, currentUser } = useHub();

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
          vatRate: 16,
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

  return (
    <div className="space-y-6">
      
      {/* Top Action Bar & Filters */}
      <div className="bg-white p-4 border-2 border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-900 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="SEARCH INVOICE #, IRN, OR CUSTOMER NAME..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs font-mono font-bold border-2 border-slate-900 bg-slate-50 focus:bg-white focus:outline-none uppercase text-slate-900"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3 font-mono">
          
          <div className="flex items-center space-x-1 text-xs text-slate-900">
            <Filter className="w-3.5 h-3.5 text-slate-900" />
            <span className="font-black uppercase">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border-2 border-slate-900 px-2.5 py-1.5 text-xs text-slate-900 font-black uppercase focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="SIGNED">SIGNED (NRS Stamped)</option>
              <option value="APPROVED">APPROVED</option>
              <option value="PENDING_NRS_STAMP">PENDING STAMP</option>
              <option value="REJECTED">REJECTED / ERROR</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>

          <div className="flex items-center space-x-1 text-xs text-slate-900">
            <span className="font-black uppercase">Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-white border-2 border-slate-900 px-2.5 py-1.5 text-xs text-slate-900 font-black uppercase focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Document Types</option>
              <option value="STANDARD">Standard Invoice</option>
              <option value="CREDIT_NOTE">Credit Note</option>
              <option value="DEBIT_NOTE">Debit Note</option>
            </select>
          </div>

        </div>

      </div>

      {/* Invoices Master Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white border-b-2 border-slate-900 flex items-center justify-between font-mono">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-black uppercase tracking-wider">
              {activeTenant.name} Invoices Ledger ({filteredInvoices.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-300">
            Format: <strong className="text-amber-400">{activeTenant.platformType}</strong>
          </span>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-8 text-center text-slate-900 font-mono">
            <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-black uppercase">No invoices match your filter criteria.</p>
            <p className="text-xs text-slate-600 mt-1">Try clearing filters or transmitting a test transaction.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono">
              <thead>
                <tr className="bg-slate-100 text-slate-900 uppercase text-[10px] tracking-wider border-b-2 border-slate-900">
                  <th className="py-2.5 px-3 border-r border-slate-300"></th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Client Inv #</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Type & Kind</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Customer</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Grand Total</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">NRS Gateway IRN</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Compliance Status</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">Ledger Writeback</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 text-xs text-slate-900">
                {filteredInvoices.map((inv) => {
                  const isExpanded = expandedInvoiceId === inv.id;

                  return (
                    <tr key={inv.id} className={`hover:bg-slate-100 transition ${isExpanded ? 'bg-amber-50' : ''}`}>
                      <td className="py-3 px-3 border-r border-slate-200">
                        <button
                          onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                          className="text-slate-900 hover:text-amber-600 cursor-pointer"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>

                      <td className="py-3 px-3 font-black text-slate-900 border-r border-slate-200">
                        {inv.clientInvoiceNumber}
                        <div className="text-[10px] text-slate-500 font-normal">{inv.issueDate}</div>
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        <div className="flex flex-col space-y-0.5">
                          <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-black border border-slate-900 uppercase w-max ${
                            inv.invoiceType === 'CREDIT_NOTE' ? 'bg-slate-900 text-white' :
                            inv.invoiceType === 'DEBIT_NOTE' ? 'bg-amber-400 text-slate-950' :
                            'bg-slate-200 text-slate-950'
                          }`}>
                            {inv.invoiceType}
                          </span>
                          <span className="text-[10px] text-slate-600">Kind: {inv.invoiceKind}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-[160px] border-r border-slate-200">
                        <div className="font-bold text-slate-900 truncate" title={inv.customerName}>
                          {inv.customerName}
                        </div>
                        <div className="text-[10px] text-slate-600 font-mono">
                          TIN: {inv.customerTin || 'N/A (B2C)'}
                        </div>
                      </td>

                      <td className="py-3 px-3 font-black text-slate-900 border-r border-slate-200">
                        KES {inv.grandTotal.toLocaleString()}
                        <div className="text-[10px] text-slate-600 font-normal">VAT: KES {inv.totalVat.toLocaleString()}</div>
                      </td>

                      <td className="py-3 px-3 font-mono text-[11px] border-r border-slate-200">
                        {inv.irn ? (
                          <div className="flex items-center space-x-1 text-slate-900 font-black">
                            <span className="truncate max-w-[140px]" title={inv.irn}>{inv.irn}</span>
                            <button
                              onClick={() => setQrModalInvoice(inv)}
                              className="text-slate-900 hover:text-amber-600 p-0.5 cursor-pointer"
                              title="Show Official QR Code"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-amber-700 font-bold uppercase text-[10px]">Pending Stamp</span>
                        )}
                        {inv.originalIrn && (
                          <div className="text-[10px] text-slate-600 font-mono truncate" title={`Linked Original IRN: ${inv.originalIrn}`}>
                            Ref: {inv.originalIrn.substring(0, 14)}...
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border border-slate-900 uppercase ${
                          inv.status === 'SIGNED' || inv.status === 'APPROVED' ? 'bg-emerald-400 text-slate-950' :
                          inv.status === 'PENDING_NRS_STAMP' ? 'bg-amber-400 text-slate-950' :
                          inv.status === 'REJECTED' ? 'bg-red-500 text-white' :
                          'bg-slate-200 text-slate-900'
                        }`}>
                          {inv.status === 'SIGNED' || inv.status === 'APPROVED' ? (
                            <CheckCircle2 className="w-3 h-3 mr-1 text-slate-950" />
                          ) : inv.status === 'REJECTED' ? (
                            <AlertCircle className="w-3 h-3 mr-1 text-white" />
                          ) : null}
                          {inv.status}
                        </span>
                      </td>

                      <td className="py-3 px-3 border-r border-slate-200">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border border-slate-900 uppercase ${
                          inv.ledgerWritebackStatus === 'SYNCED' ? 'bg-slate-900 text-amber-400' :
                          'bg-amber-200 text-slate-900'
                        }`}>
                          {inv.ledgerWritebackStatus === 'SYNCED' ? 'Synced to ERP' : 'Pending Writeback'}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          
                          {/* Inspect CittaEFS JSON Payload */}
                          <button
                            onClick={() => setSelectedPayloadInvoice(inv)}
                            className="p-1 bg-white border border-slate-900 hover:bg-slate-900 hover:text-white transition cursor-pointer"
                            title="Inspect CittaEFS JSON Payload"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                          </button>

                          {/* Issue Credit Note Button */}
                          {true && inv.status === 'SIGNED' && inv.invoiceType === 'STANDARD' && (
                            <button
                              onClick={() => setCreditNoteModalInvoice(inv)}
                              className="p-1 bg-amber-400 border border-slate-900 text-slate-950 hover:bg-amber-300 transition cursor-pointer"
                              title="Issue Linked Credit Note"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Cancel Invoice */}
                          {true && inv.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleCancelInvoice(inv)}
                              className="p-1 bg-red-100 border border-slate-900 text-red-700 hover:bg-red-600 hover:text-white transition cursor-pointer"
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

      {/* Expanded Line Item Details Panel (if selected) */}
      {expandedInvoiceId && (() => {
        const inv = tenantInvoices.find(i => i.id === expandedInvoiceId);
        if (!inv) return null;

        return (
          <div className="bg-slate-900 text-white p-5 border-2 border-slate-900 font-mono space-y-4">
            <div className="flex items-center justify-between pb-2 border-b-2 border-slate-800">
              <h4 className="text-sm font-black text-amber-400 uppercase tracking-tight flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                Line Item Breakdown for {inv.clientInvoiceNumber} ({inv.lineItems.length} items)
              </h4>
              <button
                onClick={() => setExpandedInvoiceId(null)}
                className="text-xs text-slate-400 hover:text-amber-400 cursor-pointer uppercase font-black"
              >
                [CLOSE]
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 border-2 border-slate-800">
                <thead className="bg-slate-800 text-amber-400 uppercase text-[10px] tracking-wider border-b-2 border-slate-800">
                  <tr>
                    <th className="py-2 px-3 border-r border-slate-800">Item SKU</th>
                    <th className="py-2 px-3 border-r border-slate-800">Description</th>
                    <th className="py-2 px-3 border-r border-slate-800">Qty</th>
                    <th className="py-2 px-3 border-r border-slate-800">Unit Price</th>
                    <th className="py-2 px-3 border-r border-slate-800">Taxable</th>
                    <th className="py-2 px-3 border-r border-slate-800">VAT %</th>
                    <th className="py-2 px-3 border-r border-slate-800">Mandatory HS Code</th>
                    <th className="py-2 px-3 text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {inv.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td className="py-2 px-3 font-mono font-black text-amber-400 border-r border-slate-800">{li.itemCode}</td>
                      <td className="py-2 px-3 border-r border-slate-800">{li.description}</td>
                      <td className="py-2 px-3 border-r border-slate-800">{li.quantity}</td>
                      <td className="py-2 px-3 border-r border-slate-800">KES {li.unitPrice.toLocaleString()}</td>
                      <td className="py-2 px-3 border-r border-slate-800">KES {li.taxableAmount.toLocaleString()}</td>
                      <td className="py-2 px-3 border-r border-slate-800">{li.vatRate}%</td>
                      <td className="py-2 px-3 font-mono border-r border-slate-800">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border ${
                          li.hsOrServiceCode === 'UNMAPPED' ? 'bg-red-950 text-red-300 border-red-800' : 'bg-emerald-400 text-slate-950 border-slate-900'
                        }`}>
                          {li.hsOrServiceCode} ({li.codeType})
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-black text-white">
                        KES {li.totalAmount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {inv.errorMessage && (
              <div className="p-3 bg-red-950 border-2 border-red-600 text-xs text-red-200">
                <strong>Pre-flight Exception:</strong> {inv.errorMessage}
              </div>
            )}
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
                  Credit Adjustment Amount (KES)
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
