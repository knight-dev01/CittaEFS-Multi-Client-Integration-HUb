import { Fragment, useMemo, useState } from 'react';
import { useHub } from '../lib/store';
import type { ValidationErrorItem } from '../types';
import { ShieldAlert, RefreshCw, ChevronDown, ChevronRight, Wand2 } from 'lucide-react';
import { StatusBadge, statusTone } from './ui/StatusBadge';
import { PageHeader } from './ui/PageHeader';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Field';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { splitGatewayErrorMessage } from '../lib/gatewayErrors';

type QuickView = 'OPEN' | 'RESOLVED' | 'ALL';

// Only these two categories carry a correction the backend can apply
// (routes/validation.ts `/resolve`) — everything else just flips the row to
// RESOLVED with no patch, so it gets a "mark resolved" action, not a form
// that implies a fix was made.
const FIXABLE_CATEGORIES = new Set(['MISSING_HS_CODE', 'INVALID_TIN_FORMAT', 'MISSING_B2B_TIN']);

const CATEGORY_LABELS: Record<string, string> = {
  MISSING_HS_CODE: 'Missing HS / service code',
  INVALID_TIN_FORMAT: 'Invalid TIN format',
  INVALID_DATE: 'Invalid date',
  MISSING_B2B_TIN: 'Missing B2B TIN',
  TAX_MISMATCH: 'Tax mismatch',
  DUPLICATE_INVOICE: 'Duplicate invoice',
  GATEWAY_REJECTED: 'CittaEFS rejected',
  GATEWAY_NOT_CONFIGURED: 'Gateway key missing',
  TRANSMIT_FAILED: 'Transmit failed',
};

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function FixForm({ error, onResolve }: { error: ValidationErrorItem; onResolve: (hsOrServiceCode?: string, correctedTin?: string) => Promise<void> }) {
  const isTinFix = error.errorCategory === 'INVALID_TIN_FORMAT' || error.errorCategory === 'MISSING_B2B_TIN';
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const cleaned = value.trim();
    if (!cleaned) return;
    setSubmitting(true);
    try {
      await onResolve(isTinFix ? undefined : cleaned, isTinFix ? cleaned : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label className="block text-xs font-medium text-ink-soft" htmlFor={`fix-${error.id}`}>
          {isTinFix ? 'Corrected TIN' : 'Correct HS or service code'}
        </label>
        <Input
          id={`fix-${error.id}`}
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder={isTinFix ? 'P099112233X' : '8130 or 8471.30'}
          className="mt-1 font-mono"
        />
      </div>
      <Button size="sm" onClick={submit} disabled={submitting || !value.trim()}>
        {submitting ? 'Applying…' : 'Apply fix'}
      </Button>
    </div>
  );
}

export function ValidationTab() {
  const { validationErrors, activeTenant, resolveValidationError, bulkResolveValidationErrors, autoMapItems, refreshAll, isBgRefreshing } = useHub() as any;

  const [searchTerm, setSearchTerm] = useState('');
  const [quickView, setQuickView] = useState<QuickView>('OPEN');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoMapping, setAutoMapping] = useState(false);
  const [bulkDismissing, setBulkDismissing] = useState(false);

  const tenantErrors: ValidationErrorItem[] = useMemo(
    () => (validationErrors || []).filter((e: ValidationErrorItem) => e.tenantId === activeTenant?.id),
    [validationErrors, activeTenant?.id]
  );

  const openCount = useMemo(() => tenantErrors.filter(e => e.status === 'OPEN').length, [tenantErrors]);

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return tenantErrors.filter(e => {
      const matchesView = quickView === 'ALL' || e.status === quickView;
      const matchesCategory = categoryFilter === 'ALL' || e.errorCategory === categoryFilter;
      const matchesSearch = !query
        || e.clientInvoiceNumber?.toLowerCase().includes(query)
        || e.errorMessage?.toLowerCase().includes(query);
      return matchesView && matchesCategory && matchesSearch;
    });
  }, [tenantErrors, searchTerm, quickView, categoryFilter]);

  if (!activeTenant) {
    return <p className="py-16 text-center text-sm text-ink-soft">No workspace — connect an ERP to see validation errors.</p>;
  }

  const handleAutoMap = async () => {
    setAutoMapping(true);
    try { await autoMapItems(); } finally { setAutoMapping(false); }
  };

  const handleBulkDismiss = async () => {
    if (!confirm(`Dismiss all ${openCount} open error(s) for ${activeTenant.name}?\n\nThis marks them RESOLVED without applying any correction — use it to clear stale entries, not to fix data.`)) return;
    setBulkDismissing(true);
    try { await bulkResolveValidationErrors(activeTenant.id); } finally { setBulkDismissing(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Validation"
        subtitle={<>Errors raised while normalising invoices for <span className="font-medium text-ink">{activeTenant.name}</span>.</>}
        actions={(
          <>
            <Button variant="secondary" onClick={handleAutoMap} disabled={autoMapping}>
              <Wand2 className={`h-3.5 w-3.5 ${autoMapping ? 'animate-spin' : ''}`} />
              {autoMapping ? 'Mapping…' : 'Auto-map items'}
            </Button>
            <Button variant="secondary" onClick={() => refreshAll()} disabled={isBgRefreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${isBgRefreshing ? 'animate-spin' : ''}`} />
              {isBgRefreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        )}
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3 lg:flex-row lg:items-center lg:justify-between">
        <Input
          type="text"
          placeholder="Search invoice number or message"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="max-w-md"
          aria-label="Search validation errors"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'OPEN', label: 'Open' },
            { id: 'RESOLVED', label: 'Resolved' },
            { id: 'ALL', label: 'All' },
          ] as { id: QuickView; label: string }[]).map(view => (
            <button
              key={view.id}
              onClick={() => setQuickView(view.id)}
              aria-pressed={quickView === view.id}
              className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                quickView === view.id ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-ink-soft hover:bg-panel-muted'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>

        <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-full lg:w-auto" aria-label="Filter by category">
          <option value="ALL">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </div>

      {openCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-panel-muted px-4 py-2.5 text-xs text-ink-soft">
          <span>{openCount} open error{openCount === 1 ? '' : 's'} for this ERP.</span>
          <Button size="sm" variant="ghost" onClick={handleBulkDismiss} disabled={bulkDismissing}>
            {bulkDismissing ? 'Dismissing…' : 'Dismiss all open'}
          </Button>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Validation queue</h2>
            <p className="mt-0.5 text-xs text-ink-faint">{activeTenant.name} — {filtered.length} shown</p>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No validation errors to show"
            description={quickView === 'OPEN' ? 'Nothing is currently blocking normalisation.' : 'Nothing matches the current filters.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-panel-muted text-xs font-medium text-ink-soft">
                  <th className="w-9 py-3 pl-4" />
                  <th className="py-3 pr-4">Invoice</th>
                  <th className="py-3 pr-4">Category</th>
                  <th className="py-3 pr-4">Message</th>
                  <th className="py-3 pr-4">Raised</th>
                  <th className="py-3 pr-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(error => {
                  const isExpanded = expandedId === error.id;
                  const isOpen = error.status === 'OPEN';
                  const message = splitGatewayErrorMessage(error.errorMessage);
                  return (
                    <Fragment key={error.id}>
                      <tr className={`transition-colors hover:bg-panel-muted ${isExpanded ? 'bg-accent-soft/50' : ''}`}>
                        <td className="py-3 pl-4">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : error.id)}
                            className="cursor-pointer rounded-md p-1 text-ink-faint transition-colors hover:bg-panel-muted hover:text-ink"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="py-3 pr-4 font-medium text-ink">{error.clientInvoiceNumber || '—'}</td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex w-max items-center rounded-md border border-line bg-panel-muted px-1.5 py-0.5 text-xs font-medium text-ink-soft">
                            {CATEGORY_LABELS[error.errorCategory] || error.errorCategory}
                          </span>
                        </td>
                        <td className="max-w-80 truncate py-3 pr-4 text-ink-soft" title={message.summary}>{message.summary}</td>
                        <td className="py-3 pr-4 text-xs text-ink-faint">{formatDate(error.createdAt)}</td>
                        <td className="py-3 pr-5">
                          <StatusBadge tone={statusTone(error.status)}>{error.status}</StatusBadge>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-panel-muted/60">
                          <td />
                          <td colSpan={5} className="space-y-3 py-4 pr-5">
                            <p className="max-w-3xl leading-relaxed text-ink">{message.summary}</p>
                            {message.technical && (
                              <details className="max-w-3xl rounded-md border border-line bg-panel px-3 py-2">
                                <summary className="cursor-pointer text-xs font-medium text-ink-soft">
                                  Technical detail
                                </summary>
                                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-faint">
                                  {message.technical}
                                </pre>
                              </details>
                            )}
                            {isOpen ? (
                              FIXABLE_CATEGORIES.has(error.errorCategory) ? (
                                <FixForm
                                  error={error}
                                  onResolve={async (hsOrServiceCode, correctedTin) => {
                                    await resolveValidationError(error.id, hsOrServiceCode, correctedTin);
                                    setExpandedId(null);
                                  }}
                                />
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={async () => { await resolveValidationError(error.id); setExpandedId(null); }}
                                >
                                  Mark resolved
                                </Button>
                              )
                            ) : (
                              <p className="text-xs text-ink-faint">Already {error.status.toLowerCase()} — no action needed.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
