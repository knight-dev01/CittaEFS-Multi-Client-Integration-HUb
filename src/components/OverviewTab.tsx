import { useState, useMemo } from 'react';
import { useHub } from '../lib/store';
import { 
  Search,
  Download,
  Printer,
  MessageSquare,
  Mail,
  Monitor,
  X,
  Building2,
  Trash2,
  Plus,
  QrCode,
  CheckCircle2
} from 'lucide-react';

interface OverviewTabProps {
  onOpenOnboardModal?: () => void;
}

export function OverviewTab({ onOpenOnboardModal }: OverviewTabProps) {
  const { tenants, invoices, activeTenant, purgeDemoData, currentUser, deleteTenant, setActiveTenantId } = useHub() as any;

  const userRole = currentUser?.role || 'OPERATOR';
  const canOnboard = userRole === 'ADMIN';
  const canDeleteTenant = userRole === 'ADMIN';
  const canPurge = userRole === 'ADMIN';

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 7;

  const handlePurge = async () => {
    if (!canPurge) return;
    if (window.confirm('Purge test invoices, validation errors and audit logs?')) {
      await purgeDemoData();
      alert('Staging data purged.');
    }
  };

  const handleDeleteTenant = async (tenant: any) => {
    if (!canDeleteTenant) return;
    if (!window.confirm(`Delete workspace "${tenant.name}" (${tenant.id})? Cascades all data.`)) return;
    const typed = window.prompt(`Type DELETE to confirm removal of "${tenant.name}":`, "");
    if (typed !== 'DELETE') { if (typed !== null) alert('Cancelled.'); return; }
    try { await deleteTenant(tenant.id); } catch (e: any) { alert(e.message || 'Failed'); }
  };

  const tenantInvoices = useMemo(() => {
    if (!activeTenant) return [];
    return invoices.filter((inv: any) => inv.tenantId === activeTenant.id);
  }, [invoices, activeTenant]);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return tenantInvoices;
    const q = searchTerm.toLowerCase();
    return tenantInvoices.filter((inv: any) =>
      inv.clientInvoiceNumber?.toLowerCase().includes(q) ||
      inv.customerName?.toLowerCase().includes(q) ||
      inv.customerTin?.toLowerCase().includes(q) ||
      String(inv.grandTotal ?? inv.totalAmount ?? '').toLowerCase().includes(q)
    );
  }, [tenantInvoices, searchTerm]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const getStatusStyle = (status: string) => {
    if (status === 'APPROVED' || status === 'SIGNED') return 'bg-emerald-500 text-white';
    if (status === 'PENDING_NRS_STAMP' || status === 'QUEUED' || status === 'PENDING') return 'bg-amber-100 text-amber-800 border border-amber-200';
    if (status === 'REJECTED' || status === 'CANCELLED') return 'bg-rose-100 text-rose-700 border border-rose-200';
    return 'bg-slate-100 text-slate-700 border border-slate-200';
  };
  const getStatusLabel = (status: string) => {
    if (status === 'APPROVED' || status === 'SIGNED') return 'Paid';
    if (status === 'PENDING_NRS_STAMP' || status === 'QUEUED') return 'Pending';
    if (status === 'REJECTED') return 'Overdue';
    return status;
  };

  if (!activeTenant) {
    return <div className="p-8 text-center text-slate-400 text-xs">No workspace — onboard a client to see dashboard.</div>;
  }

  const computeInvoiceTotals = (inv: any) => {
    const items = inv.lineItems || [];
    const subtotal = items.reduce((s: number, li: any) => s + Number(li.taxableAmount ?? li.quantity * li.unitPrice ?? 0), 0) || Number(inv.subtotal ?? 0);
    const vat = items.reduce((s: number, li: any) => s + Number(li.vatAmount ?? 0), 0) || Number(inv.taxAmount ?? inv.totalVat ?? 0);
    const total = Number(inv.totalAmount ?? inv.grandTotal ?? subtotal + vat);
    return { subtotal, vat, total, items };
  };

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* Top business header — DigiTax style using our tenant */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div>
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Business: {activeTenant.name}</span>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
              {(activeTenant.name || 'CN').slice(0,2).toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm flex items-center gap-2">{activeTenant.name} <span className="text-[11px] text-slate-500 font-normal">• {activeTenant.platformType}</span></div>
              <div className="text-[11px] text-slate-500 font-mono">TIN: {activeTenant.tin} • {activeTenant.companyName}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canOnboard && (
            <button onClick={onOpenOnboardModal} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg flex items-center gap-2 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> New Invoice
            </button>
          )}
          {canPurge && (
            <button onClick={handlePurge} className="px-3 py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer">Clear Staging</button>
          )}
        </div>
      </div>

      {/* Workspace switcher — simple, same style as DigiTax business selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Workspaces:</span>
        <div className="flex flex-wrap gap-1.5">
          {tenants.map((t: any) => (
            <button key={t.id} onClick={() => setActiveTenantId(t.id)} className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${t.id === activeTenant.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer'}`}>
              {t.name}
            </button>
          ))}
        </div>
        {canDeleteTenant && tenants.length > 0 && (
          <button onClick={() => handleDeleteTenant(activeTenant)} title="Remove active workspace" className="ml-auto p-1.5 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 rounded-lg cursor-pointer">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Sale Invoices — DigiTax layout, our NGN/NRS data */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="font-bold text-slate-900 text-sm">Sale Invoices</h2>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(1); }} placeholder="Search invoice, customer, inv" className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-2.5 px-4">Invoice No.</th>
                <th className="py-2.5 px-4">Customer</th>
                <th className="py-2.5 px-4">Invoice Date</th>
                <th className="py-2.5 px-4 text-right">Amount (NGN)</th>
                <th className="py-2.5 px-4 text-center">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginated.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">No invoices match. Try onboard or import — or adjust search.</td></tr>
              ) : paginated.map((inv: any) => {
                const amt = Number(inv.grandTotal ?? inv.totalAmount ?? 0);
                return (
                  <tr key={inv.id} onClick={() => setSelectedInvoice(inv)} className={`hover:bg-emerald-50/40 cursor-pointer ${selectedInvoice?.id === inv.id ? 'bg-emerald-50' : ''}`}>
                    <td className="py-3 px-4 font-semibold text-slate-900">{inv.clientInvoiceNumber}</td>
                    <td className="py-3 px-4 text-slate-700">{inv.customerName}</td>
                    <td className="py-3 px-4 text-slate-600">{inv.issueDate ? new Date(inv.issueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">{amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${getStatusStyle(inv.status)}`}>{getStatusLabel(inv.status)}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedInvoice(inv); }} className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer">View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Showing {paginated.length ? (page-1)*pageSize+1 : 0} to {Math.min(page*pageSize, filtered.length)} of {filtered.length} entries</span>
          <div className="flex items-center gap-1">
            <button disabled={page===1} onClick={() => setPage(p=>Math.max(1,p-1))} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs disabled:opacity-40 cursor-pointer">‹</button>
            {Array.from({ length: totalPages }).slice(0,5).map((_, i) => {
              const n = i+1;
              return <button key={n} onClick={() => setPage(n)} className={`w-7 h-7 rounded-lg text-xs font-semibold border ${page===n ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer'}`}>{n}</button>;
            })}
            {totalPages > 5 && <span className="px-1 text-slate-400">…</span>}
            <button disabled={page===totalPages} onClick={() => setPage(p=>Math.min(totalPages,p+1))} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs disabled:opacity-40 cursor-pointer">›</button>
          </div>
        </div>
      </div>

      {/* Detail modal — mirrors DigiTax Sale Invoice #3013 but with NGN/NRS/NGA */}
      {selectedInvoice && (() => {
        const inv = selectedInvoice;
        const { subtotal, vat, total, items } = computeInvoiceTotals(inv);
        return (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setSelectedInvoice(null)}>
            <div className="bg-white w-full max-w-3xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-8" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-base">Sale Invoice {inv.clientInvoiceNumber}</h3>
                <button onClick={() => setSelectedInvoice(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <div className="px-6 py-2 flex items-center gap-6 text-emerald-600 border-b border-slate-100">
                <button className="flex flex-col items-center gap-1 py-2 text-xs font-semibold cursor-pointer"><Download className="w-5 h-5" /> Download</button>
                <button className="flex flex-col items-center gap-1 py-2 text-xs font-semibold cursor-pointer"><Printer className="w-5 h-5" /> Print</button>
                <button className="flex flex-col items-center gap-1 py-2 text-xs font-semibold cursor-pointer"><MessageSquare className="w-5 h-5" /> SMS</button>
                <button className="flex flex-col items-center gap-1 py-2 text-xs font-semibold cursor-pointer"><Mail className="w-5 h-5" /> Email</button>
                <button className="flex flex-col items-center gap-1 py-2 text-xs font-semibold cursor-pointer"><Monitor className="w-5 h-5" /> POS Print</button>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-slate-500 text-[11px] uppercase">From</span>
                    <div className="font-bold text-slate-900 mt-1">{activeTenant.companyName || activeTenant.name}</div>
                    <div className="text-slate-600">P.O. Box — </div>
                    <div className="text-slate-600">Lagos, Nigeria</div>
                    <div className="text-slate-600">TIN: {activeTenant.tin}</div>
                    <div className="text-slate-600">Tel: +234 700 000 000</div>
                    <div className="text-slate-600">Email: billing@{activeTenant.name.toLowerCase().replace(/[^a-z0-9]/g,'')}.com</div>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 text-[11px] uppercase">To</span>
                    <div className="font-bold text-slate-900 mt-1">{inv.customerName}</div>
                    <div className="text-slate-600">{inv.customerCode}</div>
                    <div className="text-slate-600">Nigeria</div>
                    <div className="text-slate-600">TIN: {inv.customerTin || '— (B2C)'}</div>
                    <div className="text-slate-600">Tel: —</div>
                    <div className="text-slate-600">Email: —</div>
                  </div>
                  <div className="text-right space-y-2">
                    <div><span className="text-slate-500">Invoice Date</span><div className="font-semibold text-slate-900">{inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : '—'}</div></div>
                    <div><span className="text-slate-500">Invoice No.</span><div className="font-mono font-bold text-slate-900">{inv.clientInvoiceNumber}</div></div>
                    {inv.documentNumber && inv.documentNumber !== inv.clientInvoiceNumber && <div><span className="text-slate-500">Document No.</span><div className="font-mono text-slate-700">{inv.documentNumber}</div></div>}
                    <div><span className="text-slate-500">Due Date</span><div className="font-semibold text-slate-900">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</div></div>
                    {inv.irn && <div className="pt-1"><span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold flex items-center gap-1 justify-end w-fit ml-auto"><CheckCircle2 className="w-3 h-3" /> IRN: {inv.irn.slice(0,18)}…</span></div>}
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-emerald-50 text-emerald-900 text-[11px] font-semibold border-b border-emerald-100">
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Item Description</th>
                        <th className="py-2 px-3 text-center">Qty</th>
                        <th className="py-2 px-3 text-right">Unit Price</th>
                        <th className="py-2 px-3 text-center">VAT (%)</th>
                        <th className="py-2 px-3 text-right">Amount (NGN)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {items.length ? items.map((li: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="py-2 px-3 text-center">{idx+1}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{li.description || li.itemCode}</td>
                          <td className="py-2 px-3 text-center">{li.quantity}</td>
                          <td className="py-2 px-3 text-right">{Number(li.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 px-3 text-center">{li.vatRate ?? 7.5}</td>
                          <td className="py-2 px-3 text-right font-semibold">{Number(li.totalAmount ?? li.taxableAmount + li.vatAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={6} className="p-4 text-center text-slate-400">No line items</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-1 space-y-3 text-xs">
                    <div><span className="font-semibold text-slate-700">Amount in Words</span><div className="text-slate-600 mt-1">Nigeria Naira — {total.toLocaleString()} Only</div></div>
                    <div><span className="font-semibold text-slate-700">Payment Terms</span><div className="text-slate-600 mt-1">Payment due within 30 days.</div></div>
                  </div>
                  <div className="space-y-2 bg-slate-50 rounded-xl border border-slate-200 p-3 text-xs self-start">
                    <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span className="font-semibold text-slate-900">{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">VAT (7.5%)</span><span className="font-semibold text-slate-900">{vat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between bg-emerald-500 text-white rounded-lg px-3 py-2 font-bold"><span>Total (NGN)</span><span>{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                  </div>
                  <div className="flex flex-col items-center gap-2 border border-slate-200 rounded-xl p-3 bg-white self-start">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-500">NRS Invoice QR Code</span>
                    <div className="w-28 h-28 bg-slate-900 rounded-lg flex items-center justify-center overflow-hidden">
                      {inv.qrCodeUrl ? (
                        <img src={inv.qrCodeUrl} alt="QR" className="w-full h-full object-cover" />
                      ) : (
                        <QrCode className="w-12 h-12 text-white/80" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 text-center">Scan to verify on NRS</span>
                    {inv.irn && <span className="font-mono text-[10px] text-slate-600 break-all text-center">{inv.irn}</span>}
                  </div>
                </div>

                <div className="text-center text-[11px] text-slate-500 pt-2 border-t border-slate-100">Thank you for your business!</div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
