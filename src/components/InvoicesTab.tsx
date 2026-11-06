import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { toastGlobal } from './ui/Toast';
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
  RotateCcw,
  Download,
} from 'lucide-react';
import { StatusBadge, statusTone, writebackTone } from './ui/StatusBadge';
import { PageHeader } from './ui/PageHeader';
import { Button, buttonClass } from './ui/Button';
import { Input, Select } from './ui/Field';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { Notice } from './ui/Notice';

type QuickView = 'ALL' | 'PENDING' | 'APPROVED' | 'ATTENTION';

const PENDING_STATUSES = ['PENDING_NRS_STAMP', 'PENDING', 'QUEUED'];
const APPROVED_STATUSES = ['APPROVED', 'SIGNED'];
const ATTENTION_STATUSES = ['REJECTED', 'FAILED'];

const BILLING_REFERENCE_TYPES = [
  'CREDIT_NOTE',
  'CREDITNOTE',
  'DEBIT_NOTE',
  'DEBITNOTE',
  '380',
  '384',
  '393',
];

function needsBillingReference(invoice: Invoice): boolean {
  return BILLING_REFERENCE_TYPES.includes(String(invoice.invoiceType || '').toUpperCase());
}

function money(value: unknown): string {
  return `NGN ${Number(value ?? 0).toLocaleString()}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function InvoicesTab() {
  const { invoices, activeTenant, refreshAll, isBgRefreshing, retryInvoice, retryBulkInvoices } = useHub() as any;

  const [searchTerm, setSearchTerm] = useState('');
  const [quickView, setQuickView] = useState<QuickView>('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [retryingInvoiceId, setRetryingInvoiceId] = useState<string | null>(null);
  const [isBulkRetrying, setIsBulkRetrying] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'xlsx' | 'json' | null>(null);

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

  const attentionInvoices = useMemo(
    () => tenantInvoices.filter(inv => ATTENTION_STATUSES.includes(inv.status)),
    [tenantInvoices]
  );

  const handleRetryInvoice = async (invoice: Invoice) => {
    setRetryingInvoiceId(invoice.id);
    try {
      await retryInvoice(invoice.id);
    } catch {
      // store.tsx already raised a toast with the real message
    } finally {
      setRetryingInvoiceId(null);
    }
  };

  const handleRetryAllFailed = async () => {
    if (!attentionInvoices.length || !activeTenant) return;
    const proceed = window.confirm(
      `Retry ${attentionInvoices.length} failed invoice(s) for ${activeTenant.name}?\n\n` +
      `They are re-queued for CittaEFS stamping and move back to PENDING_NRS_STAMP. ` +
      `Anything still wrong at the gateway will fail again with a new error.`
    );
    if (!proceed) return;
    setIsBulkRetrying(true);
    try {
      await retryBulkInvoices(activeTenant.id, attentionInvoices.map(inv => inv.id));
    } catch {
      // store.tsx already raised a toast with the real message
    } finally {
      setIsBulkRetrying(false);
    }
  };

  const handleExport = async (format: 'csv' | 'xlsx' | 'json') => {
    if (!activeTenant) return;
    setExportingFormat(format);
    try {
      const res = await fetchWithAuth(
        `/api/invoices/export?format=${format}&tenantId=${encodeURIComponent(activeTenant.id)}`
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error) message = parsed.error;
        } catch {
          if (text.trim()) message = text.trim().slice(0, 200);
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1]
        || `cittaefs-efs-${activeTenant.id}.${format}`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const rows = res.headers.get('X-Export-Rows');
      const exported = res.headers.get('X-Export-Invoices');
      toastGlobal(
        'success',
        'EFS export ready',
        `${filename}${exported ? ` — ${exported} invoice(s)` : ''}${rows ? `, ${rows} line row(s)` : ''}.`
      );
    } catch (err: any) {
      toastGlobal('error', 'Export failed', err.message);
    } finally {
      setExportingFormat(null);
    }
  };

  if (!activeTenant) {
    return <p className="py-16 text-center text-sm text-ink-soft">No workspace — connect an ERP to see invoices.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        subtitle={<>Invoices pulled from <span className="font-medium text-ink">{activeTenant.platformType}</span> and normalised for CittaEFS.</>}
        actions={(
          <Button variant="secondary" onClick={() => refreshAll()} disabled={isBgRefreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${isBgRefreshing ? 'animate-spin' : ''}`} />
            {isBgRefreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      {/* EFS upload export */}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">EFS upload export</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            Normalised file for CittaEFS bulk upload — one row per invoice line, exact InvoiceTemplate headers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => handleExport('csv')}
            disabled={exportingFormat !== null}
            title="Download comma-separated values"
          >
            <Download className={`h-3.5 w-3.5 ${exportingFormat === 'csv' ? 'animate-pulse' : ''}`} />
            {exportingFormat === 'csv' ? 'Preparing…' : 'CSV'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExport('xlsx')}
            disabled={exportingFormat !== null}
            title="Download Excel workbook with the InvoiceTemplate sheet"
          >
            <Download className={`h-3.5 w-3.5 ${exportingFormat === 'xlsx' ? 'animate-pulse' : ''}`} />
            {exportingFormat === 'xlsx' ? 'Preparing…' : 'Excel'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExport('json')}
            disabled={exportingFormat !== null}
            title="Download the same rows as structured JSON"
          >
            <Download className={`h-3.5 w-3.5 ${exportingFormat === 'json' ? 'animate-pulse' : ''}`} />
            {exportingFormat === 'json' ? 'Preparing…' : 'JSON'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            placeholder="Search invoice number, IRN or customer"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
            aria-label="Search invoices"
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
              aria-pressed={quickView === view.id}
              className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                quickView === view.id
                  ? 'border-ink bg-ink text-white'
                  : 'border-line bg-panel text-ink-soft hover:bg-panel-muted'
              }`}
            >
              {view.label}
              <span className={`ml-1.5 ${quickView === view.id ? 'text-chrome-ink-soft' : 'text-ink-faint'}`}>{counts[view.id]}</span>
            </button>
          ))}
        </div>

        <Select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="w-full lg:w-auto"
          aria-label="Filter by document type"
        >
          <option value="ALL">All document types</option>
          <option value="STANDARD">Standard invoice</option>
          <option value="CREDIT_NOTE">Credit note</option>
          <option value="DEBIT_NOTE">Debit note</option>
        </Select>
      </div>

      {/* Invoice ledger */}
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Invoice ledger</h2>
            <p className="mt-0.5 text-xs text-ink-faint">{activeTenant.name} — {filteredInvoices.length} shown, read-only</p>
          </div>
          {attentionInvoices.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRetryAllFailed}
              disabled={isBulkRetrying}
              title="Re-queue every REJECTED or FAILED invoice for this workspace"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${isBulkRetrying ? 'animate-spin' : ''}`} />
              {isBulkRetrying ? 'Retrying…' : `Retry ${attentionInvoices.length} failed`}
            </Button>
          )}
        </div>

        {filteredInvoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices to show"
            description="Invoices appear here once the ERP has been synced."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-panel-muted text-xs font-medium text-ink-soft">
                  <th className="w-9 py-3 pl-4" />
                  <th className="py-3 pr-4">Invoice</th>
                  <th className="py-3 pr-4">Source</th>
                  <th className="py-3 pr-4">Customer</th>
                  <th className="py-3 pr-4 text-right">Total</th>
                  <th className="py-3 pr-4">IRN</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-5">Writeback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredInvoices.map(inv => {
                  const isExpanded = expandedInvoiceId === inv.id;
                  return (
                    <tr
                      key={inv.id}
                      className={`transition-colors hover:bg-panel-muted ${isExpanded ? 'bg-accent-soft/50' : ''}`}
                    >
                      <td className="py-3 pl-4">
                        <button
                          onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                          className="cursor-pointer rounded-md p-1 text-ink-faint transition-colors hover:bg-panel-muted hover:text-ink"
                          title={isExpanded ? 'Collapse invoice' : 'Expand invoice'}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>

                      <td className="py-3 pr-4 font-medium text-ink">
                        {inv.clientInvoiceNumber}
                        <div className="mt-0.5 text-xs font-normal text-ink-faint">{formatDate(inv.issueDate)}</div>
                      </td>

                      <td className="py-3 pr-4">
                        <span className="inline-flex w-max items-center rounded-md border border-line bg-panel-muted px-1.5 py-0.5 text-xs font-medium text-ink-soft">
                          {inv.sourceErp || activeTenant.platformType}
                        </span>
                        <div className="mt-1 text-xs text-ink-faint">{inv.invoiceType}, {inv.invoiceKind}</div>
                      </td>

                      <td className="max-w-48 py-3 pr-4">
                        <div className="truncate font-medium text-ink" title={inv.customerName}>
                          {inv.customerName}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-ink-faint">
                          TIN {inv.customerTin || 'N/A'}
                        </div>
                      </td>

                      <td className="py-3 pr-4 text-right font-medium text-ink">
                        {money(inv.grandTotal)}
                        <div className="mt-0.5 text-xs font-normal text-ink-faint">VAT {money(inv.totalVat)}</div>
                      </td>

                      <td className="py-3 pr-4 font-mono text-xs">
                        {inv.irn ? (
                          <div className="flex items-center gap-1.5 font-medium text-ink-soft">
                            <span className="max-w-36 truncate" title={inv.irn}>{inv.irn}</span>
                            {inv.verificationLink && (
                              <a
                                href={inv.verificationLink}
                                target="_blank"
                                rel="noreferrer"
                                className="p-0.5 text-ink-faint transition-colors hover:text-accent"
                                title="Verify on the NRS portal"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="font-medium text-amber-600">Pending stamp</span>
                        )}
                      </td>

                      <td className="py-3 pr-4">
                        <StatusBadge tone={statusTone(inv.status)}>
                          {APPROVED_STATUSES.includes(inv.status) && <CheckCircle2 className="mr-1 h-3 w-3" />}
                          {PENDING_STATUSES.includes(inv.status) && <Clock className="mr-1 h-3 w-3" />}
                          {inv.status}
                        </StatusBadge>
                        {ATTENTION_STATUSES.includes(inv.status) && (
                          <button
                            onClick={() => handleRetryInvoice(inv)}
                            disabled={retryingInvoiceId === inv.id}
                            title={`Re-queue ${inv.clientInvoiceNumber} for CittaEFS stamping`}
                            className="mt-1 flex cursor-pointer items-center gap-1 text-xs font-medium text-ink-soft transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RotateCcw className={`h-3 w-3 ${retryingInvoiceId === inv.id ? 'animate-spin' : ''}`} />
                            {retryingInvoiceId === inv.id ? 'Retrying…' : 'Retry'}
                          </button>
                        )}
                      </td>

                      <td className="py-3 pr-5">
                        <StatusBadge tone={writebackTone(inv.ledgerWritebackStatus)}>
                          {inv.ledgerWritebackStatus === 'SYNCED'
                            ? ATTENTION_STATUSES.includes(inv.status)
                              ? 'Error sent to ERP'
                              : 'Synced to ERP'
                            : inv.ledgerWritebackStatus === 'FAILED'
                              ? 'Writeback failed'
                              : 'Pending writeback'}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Read-only invoice detail */}
      {expandedInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          onClick={() => setExpandedInvoiceId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice ${expandedInvoice.clientInvoiceNumber}`}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink">{expandedInvoice.clientInvoiceNumber}</h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {expandedInvoice.customerName}, {expandedInvoice.invoiceType}, {expandedInvoice.invoiceKind}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setExpandedInvoiceId(null)} aria-label="Close">
                <XCircle className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 overflow-y-auto p-5">
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Issue date" value={formatDate(expandedInvoice.issueDate)} />
                <Stat label="Due date" value={formatDate(expandedInvoice.dueDate)} />
                <Stat label="Currency" value={expandedInvoice.currency || 'NGN'} />
                <Stat label="Payment" value={expandedInvoice.paymentStatus} />
              </dl>

              <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Stat label="Customer" value={
                  <>
                    <span className="block">{expandedInvoice.customerName}</span>
                    <span className="mt-0.5 block font-mono text-xs font-normal text-ink-soft">
                      {expandedInvoice.customerCode} — TIN {expandedInvoice.customerTin || 'N/A'}
                    </span>
                  </>
                } />
                <Stat label="CittaEFS IRN" mono value={
                  <>
                    <span className="break-all">{expandedInvoice.irn || 'Pending stamp'}</span>
                    {expandedInvoice.nrsStampTimestamp && (
                      <span className="mt-0.5 block font-sans text-xs font-normal text-ink-soft">
                        Stamped {formatDate(expandedInvoice.nrsStampTimestamp)}
                      </span>
                    )}
                  </>
                } />
              </dl>

              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-panel-muted text-xs font-medium text-ink-soft">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-center">Qty</th>
                      <th className="px-3 py-2 text-right">Unit price</th>
                      <th className="px-3 py-2 text-right">Taxable</th>
                      <th className="px-3 py-2 text-center">VAT</th>
                      <th className="px-3 py-2">HS / service</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(expandedInvoice.lineItems || []).map((line, index) => (
                      <tr key={line.id || `${expandedInvoice.id}-${index}`} className="hover:bg-panel-muted">
                        <td className="px-3 py-2 font-mono font-medium text-ink">{line.itemCode}</td>
                        <td className="px-3 py-2 text-ink-soft">{line.description}</td>
                        <td className="px-3 py-2 text-center text-ink-soft">{line.quantity}</td>
                        <td className="px-3 py-2 text-right text-ink-soft">{money(line.unitPrice)}</td>
                        <td className="px-3 py-2 text-right text-ink-soft">{money(line.taxableAmount)}</td>
                        <td className="px-3 py-2 text-center text-ink-soft">{line.vatRate ?? 0}%</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={line.hsOrServiceCode === 'UNMAPPED' ? 'fail' : 'neutral'}>
                            {line.hsOrServiceCode}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-ink">{money(line.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Subtotal" value={money(expandedInvoice.subtotal)} />
                <Stat label="Discount" value={money(expandedInvoice.totalDiscount)} />
                <Stat label="VAT" value={money(expandedInvoice.totalVat)} />
                <Stat label="Grand total" value={money(expandedInvoice.grandTotal)} />
              </dl>

              {expandedInvoice.errorMessage && (
                <Notice tone="fail">{expandedInvoice.errorMessage}</Notice>
              )}

              {needsBillingReference(expandedInvoice) && (
                <BillingReferenceEditor
                  key={expandedInvoice.id}
                  invoice={expandedInvoice}
                  onSaved={refreshAll}
                />
              )}

              <div className="flex flex-wrap justify-end gap-2">
                {expandedInvoice.verificationLink && (
                  <a
                    href={expandedInvoice.verificationLink}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass('secondary', 'md')}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Verify on NRS
                  </a>
                )}
                {ATTENTION_STATUSES.includes(expandedInvoice.status) && (
                  <Button
                    variant="secondary"
                    onClick={() => handleRetryInvoice(expandedInvoice)}
                    disabled={retryingInvoiceId === expandedInvoice.id}
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${retryingInvoiceId === expandedInvoice.id ? 'animate-spin' : ''}`} />
                    {retryingInvoiceId === expandedInvoice.id ? 'Retrying…' : 'Retry invoice'}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setExpandedInvoiceId(null)}>Close</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel-muted px-3 py-2.5">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium text-ink ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * Credit and debit notes (380/384/393) must point at the IRN of the invoice
 * they correct. ERP-synced notes arrive without it, so this lets the operator
 * paste it and retry without leaving the hub.
 */
function BillingReferenceEditor({
  invoice,
  onSaved,
}: {
  invoice: Invoice;
  onSaved: () => Promise<void> | void;
}) {
  const [value, setValue] = useState(invoice.billingReferenceIrns || '');
  const [saving, setSaving] = useState(false);
  const locked = APPROVED_STATUSES.includes(invoice.status);

  const handleSave = async () => {
    const irns = value.split(',').map(v => v.trim()).filter(Boolean);
    if (!irns.length) {
      toastGlobal(
        'error',
        'Billing reference required',
        "Enter the original invoice's CittaEFS IRN."
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/invoices/${invoice.id}/billing-reference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingReferenceIrns: irns, retry: true }),
      });
      const data = await parseJsonResponse<{ requeued?: boolean }>(res);
      toastGlobal(
        'success',
        'Billing reference saved',
        data.requeued
          ? 'Invoice re-queued for CittaEFS stamping. Any earlier attempt was replaced.'
          : 'Saved. Retry the invoice when you are ready.'
      );
      await onSaved();
    } catch (e: any) {
      toastGlobal('error', 'Billing reference not saved', e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-panel-muted p-3.5">
      <p className="text-sm font-medium text-ink">Original invoice reference</p>
      {locked ? (
        <p className="mt-1 text-xs text-ink-soft">
          This note is {invoice.status}, so its reference can no longer change.
          {invoice.billingReferenceIrns ? (
            <span className="mt-1 block font-mono text-xs text-ink">{invoice.billingReferenceIrns}</span>
          ) : (
            <span className="mt-1 block text-ink-soft">No reference was stored.</span>
          )}
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-soft">
            A credit or debit note must point at the invoice it corrects. Open the
            original invoice above, copy its CittaEFS IRN, paste it here, then save
            and retry. If the original is still pending, stamp it first. Saving
            replaces any earlier queued attempt.
          </p>
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="CittaEFS IRN of the original invoice"
              aria-label="Original invoice CittaEFS IRN"
              disabled={saving}
              className="flex-1 font-mono text-xs"
            />
            <Button onClick={handleSave} disabled={saving}>
              <RotateCcw className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} />
              {saving ? 'Saving…' : 'Save and retry'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
