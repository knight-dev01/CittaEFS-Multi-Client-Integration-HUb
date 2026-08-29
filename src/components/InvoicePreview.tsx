import { FileText, ShieldCheck, QrCode, AlertCircle, Building2, Calendar, Hash, Tag } from 'lucide-react';

interface PreviewLineItem {
  itemCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  hsOrServiceCode: string;
  discountAmount?: number;
}

interface InvoicePreviewProps {
  title?: string;
  clientInvoiceNumber: string;
  documentNumber?: string;
  invoiceKind: string;
  invoiceType: string;
  issueDate: string;
  customerName: string;
  customerTin?: string;
  customerCode?: string;
  currency?: string;
  lineItems: PreviewLineItem[];
  tenantName?: string;
  onConfirm?: () => void;
  onEdit?: () => void;
  confirmLabel?: string;
  isProcessing?: boolean;
  warnings?: string[];
}

function computeTotals(lineItems: PreviewLineItem[]) {
  let subtotal = 0;
  let totalVat = 0;
  const computed = lineItems.map(li => {
    const discount = li.discountAmount || 0;
    const taxable = Math.max(0, li.quantity * li.unitPrice - discount);
    const vat = (taxable * (li.vatRate ?? 7.5)) / 100;
    const total = taxable + vat;
    subtotal += taxable;
    totalVat += vat;
    return { ...li, taxable, vat, total };
  });
  return { computed, subtotal: Number(subtotal.toFixed(2)), totalVat: Number(totalVat.toFixed(2)), grandTotal: Number((subtotal + totalVat).toFixed(2)) };
}

export function InvoicePreview({
  title = "Invoice Preview — CittaEFS Payload",
  clientInvoiceNumber,
  documentNumber,
  invoiceKind,
  invoiceType,
  issueDate,
  customerName,
  customerTin,
  customerCode,
  currency = "NGN",
  lineItems,
  tenantName,
  onConfirm,
  onEdit,
  confirmLabel = "Confirm & Send to CittaEFS Gateway",
  isProcessing = false,
  warnings = [],
}: InvoicePreviewProps) {
  const { computed, subtotal, totalVat, grandTotal } = computeTotals(lineItems);
  const expectedIrn = `IRN-${invoiceKind}-${new Date().getFullYear()}-${clientInvoiceNumber.replace(/[^A-Z0-9]/gi, '').substring(0, 8).toUpperCase()} (assigned by gateway)`;
  const hasUnmapped = computed.some(li => !li.hsOrServiceCode || li.hsOrServiceCode === 'UNMAPPED' || li.hsOrServiceCode === 'SERV-DEFAULT');
  const b2cWithTinWarning = invoiceKind === 'B2C' && customerTin ? 'Buyer TIN will be stripped for B2C (spec: never permitted on B2C).' : null;
  const allWarnings = [...warnings, ...(hasUnmapped ? ['Some line items use SERV-DEFAULT / UNMAPPED — gateway may require a real HS/Service code.'] : []), ...(b2cWithTinWarning ? [b2cWithTinWarning] : [])];

  return (
    <div className="space-y-4 font-sans text-xs">
      <div className="bg-slate-900 text-white rounded-xl p-5 border border-slate-800 flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold tracking-tight">{title}</h3>
          </div>
          <p className="text-slate-400 text-xs mt-1">How this invoice will be normalized and sent to <span className="text-indigo-300 font-semibold">CittaEFS / NRS Gateway</span> — review before transmitting.</p>
          {tenantName && <p className="text-[11px] text-slate-500 mt-1">Tenant: <span className="text-slate-200 font-medium">{tenantName}</span></p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onEdit && (
            <button onClick={onEdit} className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-semibold text-xs cursor-pointer">Edit</button>
          )}
          {onConfirm && (
            <button onClick={onConfirm} disabled={isProcessing} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isProcessing ? 'Transmitting...' : confirmLabel}</span>
            </button>
          )}
        </div>
      </div>

      {allWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-amber-900 text-xs">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>Preview Warnings</span>
          </div>
          <ul className="list-disc list-inside text-amber-800 text-xs space-y-0.5">
            {allWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 font-semibold uppercase block">Client Invoice #</span>
          <span className="font-mono font-bold text-slate-900 flex items-center gap-1.5"><Hash className="w-3 h-3 text-slate-400" />{clientInvoiceNumber}</span>
          {documentNumber && <span className="text-[11px] text-slate-500 block mt-1">Doc #: {documentNumber} {documentNumber === clientInvoiceNumber ? '(same as invoice)' : '(distinct)'}</span>}
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 font-semibold uppercase block">Type / Kind</span>
          <span className="font-semibold text-slate-900 block mt-0.5"><Tag className="w-3 h-3 inline mr-1 text-slate-400" />{invoiceType} / {invoiceKind}</span>
          <span className="text-[11px] text-slate-500">QBO tenants: B2B/B2G require TIN</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 font-semibold uppercase block">Customer</span>
          <span className="font-semibold text-slate-900 block mt-0.5 flex items-center gap-1.5"><Building2 className="w-3 h-3 text-slate-400" />{customerName}</span>
          <span className="text-[11px] font-mono text-slate-600">{customerTin ? `TIN: ${customerTin}` : 'TIN: — (B2C)'} {customerCode && `· ${customerCode}`}</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 font-semibold uppercase block">Issue Date / Currency</span>
          <span className="font-semibold text-slate-900 block mt-0.5 flex items-center gap-1.5"><Calendar className="w-3 h-3 text-slate-400" />{issueDate} · {currency}</span>
          <span className="text-[11px] text-slate-500">NGN · 7.5% default VAT if omitted</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs">Line Items ({computed.length}) — Taxable / VAT / Total</span>
          <span className="text-[11px] text-slate-500">Gateway DTO: InvoiceNumber, ItemName, TaxableAmount, TaxAmount, HS/Service Code</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">SKU / Desc</th>
                <th className="py-2.5 px-3">Qty × Price</th>
                <th className="py-2.5 px-3">HS/Service</th>
                <th className="py-2.5 px-3">VAT%</th>
                <th className="py-2.5 px-3 text-right">Taxable</th>
                <th className="py-2.5 px-3 text-right">VAT</th>
                <th className="py-2.5 px-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {computed.map((li, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="py-2.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                  <td className="py-2.5 px-3 max-w-[220px]"><span className="font-mono font-semibold text-slate-900">{li.itemCode}</span><span className="block text-slate-600 truncate">{li.description}</span></td>
                  <td className="py-2.5 px-3">{li.quantity} × {currency} {li.unitPrice.toLocaleString()}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px]"><span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${!li.hsOrServiceCode || li.hsOrServiceCode==='UNMAPPED' || li.hsOrServiceCode==='SERV-DEFAULT' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{li.hsOrServiceCode}</span></td>
                  <td className="py-2.5 px-3">{li.vatRate}%</td>
                  <td className="py-2.5 px-3 text-right font-medium">{currency} {li.taxable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="py-2.5 px-3 text-right text-slate-600">{currency} {li.vat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-slate-900">{currency} {li.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-900 text-white font-semibold">
              <tr>
                <td colSpan={5} className="py-2.5 px-3 text-right text-slate-300">Totals:</td>
                <td className="py-2.5 px-3 text-right">{currency} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="py-2.5 px-3 text-right text-emerald-300">{currency} {totalVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="py-2.5 px-3 text-right text-amber-300">{currency} {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row items-start gap-4">
        <div className="w-24 h-24 bg-slate-900 rounded-lg flex items-center justify-center shrink-0 border-2 border-slate-900">
          <QrCode className="w-10 h-10 text-white/80" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Expected Gateway Result</span>
          <p className="text-xs text-slate-700 mt-1">After <span className="font-semibold">POST /api/integration/gen/invoices</span> the NRS Gateway returns a bulk result with <span className="font-mono font-semibold">{expectedIrn}</span> and QR verification URL <span className="font-mono text-indigo-600">https://nrs.portal.gov/verify?irn=...</span>. Status becomes <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold">PENDING_NRS_STAMP</span> → <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold">APPROVED</span> once the worker confirms. Check <span className="font-mono">GET /api/invoices?status=APPROVED</span>.</p>
          <p className="text-[11px] text-slate-500 mt-2">Payload hash (SHA-256) and audit log are created automatically. B2G behaves as B2B for TIN gate; B2C TIN is stripped.</p>
        </div>
      </div>

      <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5">
        <span className="text-[11px] font-semibold text-slate-700 block mb-1.5">Raw JSON that will be sent (grouped by clientInvoiceNumber)</span>
        <pre className="bg-slate-900 text-emerald-300 rounded-lg p-3 text-[11px] font-mono overflow-x-auto max-h-48 overflow-y-auto">
{JSON.stringify({ tenantId: tenantName || 'tenant_*', clientInvoiceNumber, documentNumber: documentNumber || clientInvoiceNumber, invoiceKind, invoiceType, issueDate, customerCode, customerName, customerTin: invoiceKind === 'B2C' ? undefined : customerTin, lineItems: computed.map(c => ({ itemCode: c.itemCode, description: c.description, quantity: c.quantity, unitPrice: c.unitPrice, hsOrServiceCode: c.hsOrServiceCode, vatRate: c.vatRate })), totals: { subtotal, totalVat, grandTotal } }, null, 2)}
        </pre>
      </div>
    </div>
  );
}
