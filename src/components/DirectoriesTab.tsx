import { useCallback, useEffect, useState } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import type { CustomerProfile, ItemCodeMapping } from '../types';
import { PageHeader } from './ui/PageHeader';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { EmptyState } from './ui/EmptyState';
import { Notice } from './ui/Notice';
import { StatusBadge } from './ui/StatusBadge';
import { Search, RefreshCw, Users, PackageSearch } from 'lucide-react';

type DirectoryView = 'customers' | 'items';

interface DirectoryPage<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function textOrDash(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

async function loadDirectoryPage<T>(path: string, params: URLSearchParams): Promise<DirectoryPage<T>> {
  const res = await fetchWithAuth(`${path}?${params.toString()}`);
  return parseJsonResponse<DirectoryPage<T>>(res);
}

export function DirectoriesTab() {
  const { activeTenant, isBgRefreshing } = useHub() as any;

  const [view, setView] = useState<DirectoryView>('customers');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<DirectoryPage<CustomerProfile> | null>(null);
  const [items, setItems] = useState<DirectoryPage<ItemCodeMapping> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Debounce typing: each keystroke would otherwise be a separate page query.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadCustomers = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ tenantId: activeTenant.id, page: String(page), limit: '25' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      setCustomers(await loadDirectoryPage<CustomerProfile>('/api/customers', params));
    } catch (e: any) {
      setCustomers(null);
      setLoadError(e?.message || 'Could not load customers');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, page, debouncedSearch]);

  const loadItems = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ tenantId: activeTenant.id, page: String(page), limit: '25' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      setItems(await loadDirectoryPage<ItemCodeMapping>('/api/items/mappings', params));
    } catch (e: any) {
      setItems(null);
      setLoadError(e?.message || 'Could not load items');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, page, debouncedSearch]);

  useEffect(() => {
    if (view === 'customers') loadCustomers();
    else loadItems();
  }, [view, loadCustomers, loadItems]);

  if (!activeTenant) {
    return <p className="py-16 text-center text-sm text-ink-soft">No workspace — connect an ERP to browse its directory.</p>;
  }

  const changeView = (next: DirectoryView) => {
    if (next === view) return;
    setView(next);
    setPage(1);
    setSearchTerm('');
    setDebouncedSearch('');
    setLoadError(null);
  };

  const activePage = view === 'customers' ? customers : items;
  const total = activePage?.pagination.total ?? 0;
  const totalPages = activePage?.pagination.totalPages ?? 0;
  const busy = isLoading || isBgRefreshing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Directories"
        subtitle={<>Customers and items the hub has ingested from <span className="font-medium text-ink">{activeTenant.name}</span>.</>}
        actions={(
          <Button
            variant="secondary"
            onClick={() => (view === 'customers' ? loadCustomers() : loadItems())}
            disabled={busy}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-max rounded-lg border border-line bg-panel p-0.5" role="tablist" aria-label="Directory">
          {([
            { id: 'customers' as const, label: 'Customers', icon: Users, count: customers?.pagination.total },
            { id: 'items' as const, label: 'Items', icon: PackageSearch, count: items?.pagination.total },
          ]).map(option => {
            const Icon = option.icon;
            const isActive = view === option.id;
            return (
              <button
                key={option.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => changeView(option.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent text-white' : 'text-ink-soft hover:bg-panel-muted hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4" />
                {option.label}
                {option.count !== undefined && (
                  <span className={`text-xs ${isActive ? 'text-white/80' : 'text-ink-faint'}`}>{option.count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={view === 'customers' ? 'Search name, customer code or TIN' : 'Search item, SKU or Citta code'}
            className="pl-9"
            aria-label={view === 'customers' ? 'Search customers' : 'Search items'}
          />
        </div>
      </div>

      <Notice tone="info" title="Read-only buffer">
        These rows mirror what the ERP sent. To correct one, change it in QuickBooks Online or Odoo and sync again —
        editing here is rejected by the API. A code can also be fixed from a validation error.
      </Notice>

      {loadError && <Notice tone="fail" title="Directory unavailable">{loadError}</Notice>}

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{view === 'customers' ? 'Customers' : 'Items'}</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              {total.toLocaleString()} row{total === 1 ? '' : 's'}
              {totalPages > 0 ? ` · page ${activePage?.pagination.page ?? page} of ${totalPages}` : ''}
            </p>
          </div>
        </div>

        {!activePage || activePage.data.length === 0 ? (
          <EmptyState
            icon={view === 'customers' ? Users : PackageSearch}
            title={isLoading ? 'Loading directory…' : 'Nothing matches'}
            description={
              debouncedSearch
                ? 'Clear the search to see every row in this workspace.'
                : view === 'customers'
                  ? 'Customers appear after a QBO or Odoo sync or webhook.'
                  : 'Items appear after a QBO or Odoo sync or webhook.'
            }
          />
        ) : view === 'customers' ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-panel-muted text-xs font-medium text-ink-soft">
                  <th className="py-3 pl-5 pr-4">Customer</th>
                  <th className="py-3 pr-4">TIN</th>
                  <th className="py-3 pr-4">Type</th>
                  <th className="py-3 pr-4">Location</th>
                  <th className="py-3 pr-4">Email</th>
                  <th className="py-3 pr-5">Last synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(customers?.data ?? []).map(customer => (
                  <tr key={customer.id} className="hover:bg-panel-muted">
                    <td className="py-3 pl-5 pr-4">
                      <p className="font-medium text-ink">{textOrDash(customer.name)}</p>
                      <p className="font-mono text-xs text-ink-faint">{textOrDash(customer.clientCustomerCode)}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs text-ink-soft">{textOrDash(customer.tin)}</span>
                      {customer.tinValidationStatus === 'INVALID_FORMAT' && (
                        <StatusBadge tone="fail" className="ml-1.5">bad format</StatusBadge>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge tone={customer.isB2B ? 'neutral' : 'pending'}>{customer.isB2B ? 'B2B' : 'B2C'}</StatusBadge>
                    </td>
                    <td className="py-3 pr-4 text-ink-soft">
                      {[customer.city, customer.country].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="max-w-56 truncate py-3 pr-4 text-ink-soft" title={customer.email ?? undefined}>
                      {textOrDash(customer.email)}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-5 text-xs text-ink-soft">{formatWhen(customer.lastSyncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-panel-muted text-xs font-medium text-ink-soft">
                  <th className="py-3 pl-5 pr-4">Item</th>
                  <th className="py-3 pr-4">SKU</th>
                  <th className="py-3 pr-4">Citta code</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Category</th>
                  <th className="py-3 pr-4">VAT</th>
                  <th className="py-3 pr-5">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(items?.data ?? []).map(item => (
                  <tr key={item.id} className="hover:bg-panel-muted">
                    <td className="max-w-72 py-3 pl-5 pr-4">
                      <p className="truncate font-medium text-ink" title={item.description}>{textOrDash(item.name)}</p>
                      <p className="truncate text-xs text-ink-faint" title={item.description}>{item.description}</p>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-ink-soft">{textOrDash(item.clientSku)}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-ink-soft">{textOrDash(item.hsOrServiceCode)}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge tone={item.status === 'MAPPED' ? 'ok' : 'pending'}>{item.status}</StatusBadge>
                    </td>
                    <td className="py-3 pr-4 text-ink-soft">{textOrDash(item.productCategory || item.categoryType)}</td>
                    <td className="py-3 pr-4 text-ink-soft">{item.defaultVatRate}%</td>
                    <td className="whitespace-nowrap py-3 pr-5 text-xs text-ink-soft">{formatWhen(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-ink-soft">
            <span>Page {activePage?.pagination.page ?? page} of {totalPages}</span>
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
