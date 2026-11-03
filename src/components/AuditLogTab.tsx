import { Fragment, useCallback, useEffect, useState } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import type { AuditLogEntry } from '../types';
import { PageHeader } from './ui/PageHeader';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Field, Input, Select } from './ui/Field';
import { EmptyState } from './ui/EmptyState';
import { Notice } from './ui/Notice';
import { ScrollText, RefreshCw, ChevronDown, ChevronRight, Search } from 'lucide-react';

interface AuditLogPage {
  data: AuditLogEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function AuditLogTab() {
  const { activeTenant, isBgRefreshing } = useHub() as any;

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditLogPage | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Debounce so typing a reference number doesn't fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadEntries = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        tenantId: activeTenant.id,
        page: String(page),
        limit: '25',
      });
      if (actionFilter !== 'ALL') params.set('action', actionFilter);
      if (debouncedSearch) params.set('q', debouncedSearch);

      const res = await fetchWithAuth(`/api/audit-logs?${params.toString()}`);
      const data = await parseJsonResponse<AuditLogPage>(res);
      setResult(data);
    } catch (e: any) {
      setResult(null);
      setLoadError(e?.message || 'Could not load the audit trail');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, page, actionFilter, debouncedSearch]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!activeTenant?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/audit-logs/actions?tenantId=${encodeURIComponent(activeTenant.id)}`);
        const data = await parseJsonResponse<string[]>(res);
        if (!cancelled) setActions(Array.isArray(data) ? data : []);
      } catch {
        // filter simply falls back to "All actions"
      }
    })();
    return () => { cancelled = true; };
  }, [activeTenant?.id]);

  if (!activeTenant) {
    return <p className="py-16 text-center text-sm text-ink-soft">No workspace — connect an ERP to read its audit trail.</p>;
  }

  const total = result?.pagination.total ?? 0;
  const totalPages = result?.pagination.totalPages ?? 0;
  const busy = isLoading || isBgRefreshing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        subtitle={<>Every recorded mutation for <span className="font-medium text-ink">{activeTenant.name}</span>, newest first.</>}
        actions={(
          <Button variant="secondary" onClick={loadEntries} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            placeholder="Search reference, detail or operator"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
            aria-label="Search audit entries"
          />
        </div>
        <Field label="Action" htmlFor="audit-action-filter">
          <Select
            id="audit-action-filter"
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); setPage(1); }}
            className="w-full lg:w-64"
          >
            <option value="ALL">All actions</option>
            {actions.map(action => (
              <option key={action} value={action}>{action.replaceAll('_', ' ')}</option>
            ))}
          </Select>
        </Field>
      </div>

      {loadError && <Notice tone="fail" title="Audit trail unavailable">{loadError}</Notice>}

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Recorded activity</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              {total.toLocaleString()} entr{total === 1 ? 'y' : 'ies'}
              {totalPages > 0 ? ` · page ${result?.pagination.page ?? page} of ${totalPages}` : ''}
            </p>
          </div>
        </div>

        {!result || result.data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={isLoading ? 'Loading audit trail…' : 'No audit entries match'}
            description={
              debouncedSearch || actionFilter !== 'ALL'
                ? 'Clear the search or action filter to widen the view.'
                : 'Entries appear here as invoices, connections and tenant settings change.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-panel-muted text-xs font-medium text-ink-soft">
                  <th className="w-9 py-3 pl-4" />
                  <th className="py-3 pr-4">When</th>
                  <th className="py-3 pr-4">Action</th>
                  <th className="py-3 pr-4">Entity</th>
                  <th className="py-3 pr-4">Reference</th>
                  <th className="py-3 pr-4">By</th>
                  <th className="py-3 pr-5">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.data.map(entry => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className={`cursor-pointer transition-colors hover:bg-panel-muted ${isExpanded ? 'bg-panel-muted' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      >
                        <td className="py-3 pl-4">
                          <span className="inline-flex rounded-md p-1 text-ink-faint" aria-hidden>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 text-xs text-ink-soft">{formatTimestamp(entry.createdAt)}</td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex w-max items-center rounded-md border border-line bg-panel-muted px-1.5 py-0.5 text-xs font-medium text-ink-soft">
                            {entry.action}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-xs text-ink-soft">{entry.entityType}</td>
                        <td className="max-w-56 truncate py-3 pr-4 font-medium text-ink" title={entry.entityRef}>{entry.entityRef}</td>
                        <td className="max-w-40 truncate py-3 pr-4 text-xs text-ink-soft" title={entry.performedBy}>{entry.performedBy}</td>
                        <td className="py-3 pr-5 font-mono text-xs text-ink-faint" title={entry.sha256PayloadHash}>
                          {entry.sha256PayloadHash?.slice(0, 10)}…
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-panel-muted/60">
                          <td />
                          <td colSpan={6} className="space-y-2 py-4 pr-5">
                            <p className="text-sm text-ink">{entry.details}</p>
                            <p className="break-all font-mono text-xs text-ink-faint">
                              sha256 {entry.sha256PayloadHash}
                            </p>
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-ink-soft">
            <span>Page {result?.pagination.page ?? page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(current => Math.max(1, current - 1))}
                disabled={page <= 1 || isLoading}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages || isLoading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
