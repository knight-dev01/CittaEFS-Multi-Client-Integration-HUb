import { useState, useEffect, useMemo, createContext, useContext, ReactNode } from 'react';
import { fetchWithAuth, parseJsonResponse, safeFetchJson, getApiBaseUrl } from './api';
import { toastGlobal } from '../components/ui/Toast';
import { 
  Tenant, 
  TenantErp,
  Invoice, 
  CustomerProfile, 
  ItemCodeMapping, 
  ValidationErrorItem, 
  AuditLog, 
  SystemMetrics,
  TenantId,
  UserSession 
} from '../types';

interface HubContextType {
  currentUser: UserSession | null;
  login: (session: UserSession, token?: string, refreshToken?: string) => void;
  logout: () => void;
  activeTenantId: TenantId;
  setActiveTenantId: (id: TenantId) => void;
  activeTenant: Tenant | null;
  tenants: Tenant[];
  invoices: Invoice[];
  customers: CustomerProfile[];
  itemMappings: ItemCodeMapping[];
  validationErrors: ValidationErrorItem[];
  auditLogs: AuditLog[];
  metrics: SystemMetrics;
  isBgRefreshing: boolean;
  isInitialized: boolean;
  
  // Actions
  refreshAll: () => Promise<void>;
  transmitInvoice: (payload: any, tenantIdOverride?: TenantId) => Promise<any>;
  cancelInvoice: (invoiceId: string, reason: string) => Promise<any>;
  resolveValidationError: (errorId: string, hsOrServiceCode?: string, correctedTin?: string) => Promise<any>;
  runReconciliationCron: () => Promise<any>;
  autoMapItems: () => Promise<any>;
  addCustomer: (cust: Partial<CustomerProfile>, tenantIdOverride?: TenantId) => Promise<any>;
  addItemMapping: (mapping: Partial<ItemCodeMapping>, tenantIdOverride?: TenantId) => Promise<any>;
  ingestCsvInvoices: (parsedInvoices: any[], tenantIdOverride?: TenantId) => Promise<any>;
  onboardTenant: (tenantData: any) => Promise<Tenant>;
  updateTenant: (tenantId: string, tenantData: any) => Promise<Tenant>;
  deleteTenant: (tenantId: string) => Promise<any>;
  bulkTransmitInvoices: (payloads: any[], tenantIdOverride?: string) => Promise<any>;
  tenantErps: TenantErp[];
  addTenantErp: (tenantId: string, platformType: string, displayName?: string, config?: any) => Promise<any>;
  updateTenantErp: (tenantId: string, erpId: string, data: any) => Promise<any>;
  removeTenantErp: (tenantId: string, erpId: string) => Promise<any>;
  createTenantUser: (userData: { email: string; password: string; name: string; role?: string; organization?: string; tenantId: string }) => Promise<any>;
  updateInvoice: (invoiceId: string, data: any) => Promise<any>;
  purgeDemoData: () => Promise<any>;
  retryInvoice: (invoiceId: string) => Promise<any>;
  retryBulkInvoices: (tenantId?: string, invoiceIds?: string[]) => Promise<any>;
  getRetryStatus: (invoiceId: string) => Promise<any>;
}

const HubContext = createContext<HubContextType | undefined>(undefined);

export function HubProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem('cittaefs_user_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const token = localStorage.getItem('citta_jwt_token');
    if (token) {
      safeFetchJson('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(data => {
          if (data && data.success && data.user) {
            const session: UserSession = {
              id: data.user.id,
              name: data.user.name,
              email: data.user.email,
              role: data.user.role,
              organization: data.user.organization,
              loginAt: new Date().toISOString()
            };
            setCurrentUser(session);
            try {
              localStorage.setItem('cittaefs_user_session', JSON.stringify(session));
            } catch {}
          } else if (data && data.error === 'Invalid or expired session token') {
            logout();
          }
        })
        .catch(() => {
          logout();
        });
    }
  }, []);

  const login = (session: UserSession, token?: string, refreshToken?: string) => {
    setCurrentUser(session);
    try {
      localStorage.setItem('cittaefs_user_session', JSON.stringify(session));
      if (token) {
        localStorage.setItem('citta_jwt_token', token);
      }
      if (refreshToken) {
        localStorage.setItem('citta_refresh_token', refreshToken);
      }
    } catch (e) {
      console.error('Could not save session to localStorage', e);
    }
  };

  const logout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem('cittaefs_user_session');
      localStorage.removeItem('citta_jwt_token');
      localStorage.removeItem('citta_refresh_token');
      localStorage.removeItem('citta_active_tenant_id');
      localStorage.removeItem('citta_active_tab');
    } catch (e) {
      console.error('Could not remove session from localStorage', e);
    }
  };

  const [activeTenantId, setActiveTenantIdState] = useState<TenantId>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('citta_active_tenant_id') || '';
    }
    return '';
  });

  const setActiveTenantId = (id: TenantId) => {
    setActiveTenantIdState(id);
    if (typeof window !== 'undefined') {
      if (id) {
        localStorage.setItem('citta_active_tenant_id', id);
      } else {
        localStorage.removeItem('citta_active_tenant_id');
      }
    }
  };

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [itemMappings, setItemMappings] = useState<ItemCodeMapping[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationErrorItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics>({ totalInvoicesProcessed: 0, nrsStampSuccessRate: 0, averageLatencyMs: 0, activeTenantsCount: 0, pendingValidationCount: 0, reconciliationCronStatus: 'IDLE' as any, cittaGatewayStatus: 'UNKNOWN' as any });
  const [isInitialized, setIsInitialized] = useState(false);

  // Auto-select first tenant if none selected and tenants exist
  const effectiveTenantId = tenants.length > 0 && !activeTenantId ? tenants[0].id : activeTenantId;
  const activeTenant = tenants.find(t => t.id === effectiveTenantId) || tenants[0] || null;

  // Effect to auto-select first tenant when tenants are loaded
  useEffect(() => {
    if (tenants.length > 0 && !activeTenantId) {
      setActiveTenantId(tenants[0].id);
    }
  }, [tenants, activeTenantId, setActiveTenantId]);

  const tenantErps: TenantErp[] = useMemo(() => {
    const t: any = activeTenant as any;
    if (t?.tenantErps && Array.isArray(t.tenantErps)) return t.tenantErps;
    return [];
  }, [activeTenant]);

  const [activeRequests, setActiveRequests] = useState(0);
  const isBgRefreshing = activeRequests > 0;

  const withLoading = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setActiveRequests(prev => prev + 1);
    try {
      return await fn();
    } finally {
      // Decrement active request counter
      setActiveRequests(prev => Math.max(0, prev - 1));
    }
  };

  const refreshAll = async () => {
    return withLoading(async () => {
      try {
        const fetchOrNull = (url: string) => safeFetchJson(url).catch(() => null);

        const [tenRes, invRes, custRes, itemRes, errRes, auditRes, metRes] = await Promise.all([
          fetchOrNull('/api/tenants'),
          fetchOrNull('/api/invoices'),
          fetchOrNull('/api/customers'),
          fetchOrNull('/api/items/mappings'),
          fetchOrNull('/api/validation-errors'),
          fetchOrNull('/api/audit-logs'),
          fetchOrNull('/api/metrics')
        ]);

        // Avoid resetting current activity: only update state if data actually changed
        const isSameIds = (a: any[], b: any[]) => a.length === b.length && a.every((x, i) => x.id === b[i]?.id && JSON.stringify(x) === JSON.stringify(b[i]));
        if (Array.isArray(tenRes)) {
          setTenants(prev => (isSameIds(prev as any, tenRes) ? prev : tenRes));
          // Preserve user's current workspace selection — only set if empty or URL explicitly dictates
          const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
          const urlTenantId = params?.get('tenantId');
          const savedId = typeof window !== 'undefined' ? localStorage.getItem('citta_active_tenant_id') : null;
          // Defer tenant switch if user is actively editing a form/modal
          const isEditing = typeof document !== 'undefined' && document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
          if (!isEditing) {
            if (urlTenantId && tenRes.some((t: Tenant) => t.id === urlTenantId)) {
              setActiveTenantIdState(prev => prev === urlTenantId ? prev : urlTenantId);
              if (typeof window !== 'undefined') localStorage.setItem('citta_active_tenant_id', urlTenantId);
            } else if (!activeTenantId && savedId && tenRes.some((t: Tenant) => t.id === savedId)) {
              setActiveTenantIdState(savedId);
            } else if (!activeTenantId && tenRes.length > 0) {
              setActiveTenantIdState(tenRes[0].id);
              if (typeof window !== 'undefined') localStorage.setItem('citta_active_tenant_id', tenRes[0].id);
            }
          }
        }
        const updateIfChanged = (setter: any, prev: any[], next: any) => {
          if (!Array.isArray(next)) return;
          setter((p: any[]) => (isSameIds(p, next) ? p : next));
        };
        // Use functional updates to avoid resetting local UI state (search, expanded rows) when data unchanged
        const unwrap = (r: any) => Array.isArray(r) ? r : (r?.data && Array.isArray(r.data) ? r.data : null);
        const invArr = unwrap(invRes); if (invArr) setInvoices(prev => (isSameIds(prev as any, invArr as any) ? prev : invArr));
        const custArr = unwrap(custRes); if (custArr) setCustomers(prev => (isSameIds(prev as any, custArr as any) ? prev : custArr));
        const itemArr = unwrap(itemRes); if (itemArr) setItemMappings(prev => (isSameIds(prev as any, itemArr as any) ? prev : itemArr));
        const errArr = unwrap(errRes); if (errArr) setValidationErrors(prev => (isSameIds(prev as any, errArr as any) ? prev : errArr));
        const auditArr = unwrap(auditRes); if (auditArr) setAuditLogs(prev => (isSameIds(prev as any, auditArr as any) ? prev : auditArr));
        if (metRes && typeof metRes === 'object') setMetrics(prev => JSON.stringify(prev) === JSON.stringify(metRes) ? prev : metRes);
      } catch (e) {
        console.error('Backend refresh warning, preserving local state:', e);
      } finally {
        setIsInitialized(true);
      }
    });
  };

  useEffect(() => {
    refreshAll();

    // Debounced refresh to coalesce simultaneous WS/SSE events
    let debounceTimer: any = null;
    const debouncedRefresh = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refreshAll();
      }, 500);
    };

    let eventSource: EventSource | null = null;
    let ws: WebSocket | null = null;
    let sseReconnectTimeout: any = null;
    let wsReconnectTimeout: any = null;
    let wsFailCount = 0;
    let sseActive = false;

    const connectWS = () => {
      try {
        console.log('[WS] Attempting to connect to real-time events...');
        const baseUrl = getApiBaseUrl();
        let wsUrl = '';
        if (baseUrl) {
          const wsProto = baseUrl.startsWith('https') ? 'wss:' : 'ws:';
          const host = baseUrl.replace(/^https?:\/\//, '');
          wsUrl = `${wsProto}//${host}/api/ws-events`;
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${window.location.host}/api/ws-events`;
        }
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('[WS] Connection successfully established.');
          wsFailCount = 0;
          // WS recovered — close SSE secondary channel if active
          if (sseActive && eventSource) {
            eventSource.close();
            eventSource = null;
            sseActive = false;
            if (sseReconnectTimeout) { clearTimeout(sseReconnectTimeout); sseReconnectTimeout = null; }
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'update') debouncedRefresh();
          } catch (e) {
            console.error('[WS] Error processing event data:', e);
          }
        };

        ws.onerror = (err) => {
          console.error('[WS] WebSocket encountered an error:', err);
        };

        ws.onclose = () => {
          wsFailCount++;
          console.log(`[WS] Closed (failCount=${wsFailCount}). Reconnecting in 5s...`);
          if (ws) { try { ws.close(); } catch {} ws = null; }
          wsReconnectTimeout = setTimeout(connectWS, 5000);
          // After 2 consecutive WS failures, start SSE as secondary channel
          if (wsFailCount >= 2 && !sseActive) {
            console.log('[SSE] Starting secondary channel after WS failures');
            connectSSE();
          }
        };
      } catch (err) {
        console.error('[WS] Connection error:', err);
        wsReconnectTimeout = setTimeout(connectWS, 5000);
      }
    };

    const connectSSE = () => {
      if (sseActive) return;
      sseActive = true;
      console.log('[SSE] Attempting to connect to real-time events...');
      const baseUrl = getApiBaseUrl();
      const sseUrl = baseUrl ? `${baseUrl}/api/events` : '/api/events';
      eventSource = new EventSource(sseUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'update') debouncedRefresh();
        } catch (e) {
          console.error('[SSE] Error processing event data:', e);
        }
      };

      eventSource.onerror = (err) => {
        console.error('[SSE] EventSource failed, scheduling reconnect...', err);
        if (eventSource) { eventSource.close(); eventSource = null; }
        sseActive = false;
        // Only reconnect SSE if WS is still down
        if (wsFailCount >= 2) {
          sseReconnectTimeout = setTimeout(connectSSE, 5000);
        }
      };
    };

    connectWS();

    // Backup polling — 30s, paused when tab hidden
    const backupPoll = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (ws && ws.readyState === WebSocket.OPEN) return;
      if (sseActive && eventSource && eventSource.readyState === 1) return;
      debouncedRefresh();
    }, 30000);

    return () => {
      if (eventSource) eventSource.close();
      if (ws) try { ws.close(); } catch {}
      if (sseReconnectTimeout) clearTimeout(sseReconnectTimeout);
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(backupPoll);
    };
  }, []);

  const transmitInvoice = async (payload: any, tenantIdOverride?: TenantId) => {
    return withLoading(async () => {
      try {
        const targetTenantId = tenantIdOverride || activeTenantId;
        const res = await fetchWithAuth('/api/integration/gen/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, tenantId: targetTenantId })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', `Invoice ${payload.clientInvoiceNumber || payload.documentNumber || ''} queued`, 'Sent to CittaEFS gateway for NRS stamping');
        return data;
      } catch (e: any) {
        console.error('Transmission error:', e);
        toastGlobal('error', 'Failed to send invoice', e.message || String(e));
        throw e;
      }
    });
  };

  const cancelInvoice = async (invoiceId: string, reason: string) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/invoices/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId, reason })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Invoice cancelled', 'Revocation sent to NRS portal');
        return data;
      } catch (e: any) {
        console.error('Cancel error:', e);
        toastGlobal('error', 'Cancel failed', e.message || String(e));
        throw e;
      }
    });
  };

  const resolveValidationError = async (errorId: string, hsOrServiceCode?: string, correctedTin?: string) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/validation-errors/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errorId, hsOrServiceCode, correctedTin })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Validation error resolved');
        return data;
      } catch (e: any) {
        console.error('Resolve error:', e);
        toastGlobal('error', 'Resolve failed', e.message || String(e));
        throw e;
      }
    });
  };

  const runReconciliationCron = async () => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/cron/reconcile', { method: 'POST' });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Reconciliation complete', `${data?.reconciled ?? ''} records checked`);
        return data;
      } catch (e: any) {
        console.error('Reconciliation error:', e);
        toastGlobal('error', 'Reconciliation failed', e.message || String(e));
        throw e;
      }
    });
  };

  const autoMapItems = async () => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/items/mappings/auto-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: activeTenantId })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Items auto-mapped', `${data?.mapped ?? data?.count ?? ''} items mapped`);
        return data;
      } catch (e: any) {
        console.error('Auto map error:', e);
        toastGlobal('error', 'Auto-map failed', e.message || String(e));
        throw e;
      }
    });
  };

  const addCustomer = async (cust: Partial<CustomerProfile>, tenantIdOverride?: TenantId) => {
    return withLoading(async () => {
      try {
        const targetTenantId = tenantIdOverride || activeTenantId;
        const res = await fetchWithAuth('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cust, tenantId: targetTenantId })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Customer saved', (cust as any).companyName || (cust as any).clientSystemCustId || '');
        return data;
      } catch (e: any) {
        console.error('Add customer error:', e);
        toastGlobal('error', 'Failed to save customer', e.message || String(e));
        throw e;
      }
    });
  };

  const addItemMapping = async (mapping: Partial<ItemCodeMapping>, tenantIdOverride?: TenantId) => {
    return withLoading(async () => {
      try {
        const targetTenantId = tenantIdOverride || activeTenantId;
        const res = await fetchWithAuth('/api/items/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...mapping, tenantId: targetTenantId })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Item mapping saved', (mapping as any).clientSku || (mapping as any).name || '');
        return data;
      } catch (e: any) {
        console.error('Add item mapping error:', e);
        toastGlobal('error', 'Failed to save item mapping', e.message || String(e));
        throw e;
      }
    });
  };

  const bulkTransmitInvoices = async (payloads: any[], tenantIdOverride?: string) => {
    return withLoading(async () => {
      try {
        const targetTenantId = tenantIdOverride || activeTenantId;
        const res = await fetchWithAuth('/api/integration/gen/invoices/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: targetTenantId, invoices: payloads })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        const failed = data?.failedCount || 0;
        const success = data?.successCount ?? payloads.length;
        if (failed > 0) {
          const sampleErrors = (data?.results || []).filter((r:any)=> !r.success).slice(0,2).map((r:any)=> `${r.clientInvoiceNumber}: ${(r.errors||[r.error||r.message]).join('; ')}`).join(' | ');
          toastGlobal('info', `Bulk completed: ${success} queued, ${failed} failed`, sampleErrors || 'Check Validation Errors / Rejected invoices for details');
        } else {
          toastGlobal('success', `Bulk queued ${success} invoice(s)`, data?.message || 'Sent to CittaEFS gateway');
        }
        return data;
      } catch (e: any) {
        console.error('Bulk transmit error:', e);
        toastGlobal('error', 'Bulk send failed', e.message || String(e));
        throw e;
      }
    });
  };

  const ingestCsvInvoices = async (parsedInvoices: any[], tenantIdOverride?: TenantId) => {
    if (parsedInvoices.length > 1) {
      try {
        return await bulkTransmitInvoices(parsedInvoices, tenantIdOverride);
      } catch {
        // secondary path: single transmits
      }
    }
    for (const inv of parsedInvoices) {
      await transmitInvoice(inv, tenantIdOverride);
    }
  };

  const onboardTenant = async (tenantData: any): Promise<Tenant> => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/tenants/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tenantData)
        });
        const data: Tenant = await parseJsonResponse(res);
        await refreshAll();
        if (data && data.id) {
          setActiveTenantId(data.id);
        }
        toastGlobal('success', 'Workspace created', (data as any)?.companyName || (data as any)?.name || 'Tenant onboarded');
        return data;
      } catch (e: any) {
        console.error('Onboard tenant error:', e);
        toastGlobal('error', 'Failed to create workspace', e.message || String(e));
        throw e;
      }
    });
  };

  const updateTenant = async (tenantId: string, tenantData: any): Promise<Tenant> => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth(`/api/tenants/${tenantId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tenantData)
        });
        const data: Tenant = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Workspace updated');
        return data;
      } catch (e: any) {
        console.error('Update tenant error:', e);
        toastGlobal('error', 'Update failed', e.message || String(e));
        throw e;
      }
    });
  };

  const deleteTenant = async (tenantId: string) => {
    return withLoading(async () => {
      try {
        let res: Response;
        try {
          res = await fetchWithAuth(`/api/tenants/${tenantId}`, { method: 'DELETE' });
          if (res.status === 404) {
            const txt = await res.clone().text().catch(() => '');
            if (txt.includes('API route not found')) throw new Error('DELETE_ALT');
          }
        } catch (err: any) {
          if (err.message === 'DELETE_ALT' || String(err.message).includes('API route not found')) {
            res = await fetchWithAuth(`/api/tenants/${tenantId}/delete`, { method: 'POST' }) as Response;
          } else {
            throw err;
          }
        }
        const data = await parseJsonResponse(res!);
        const wasActive = tenantId === activeTenantId;
        if (wasActive) {
          setActiveTenantId('');
          try { localStorage.removeItem('citta_active_tenant_id'); } catch {}
        }
        await refreshAll();
        toastGlobal('success', 'Workspace deleted');
        return data;
      } catch (e: any) {
        console.error('Delete tenant error:', e);
        toastGlobal('error', 'Delete failed', e.message || String(e));
        throw e;
      }
    });
  };

  const addTenantErp = async (tenantId: string, platformType: string, displayName?: string, config?: any) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platformType, displayName, config }),
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'ERP connector added', platformType);
        return data;
      } catch (e: any) {
        toastGlobal('error', 'Failed to add ERP', e.message || String(e));
        throw e;
      }
    });
  };
  const updateTenantErp = async (tenantId: string, erpId: string, data: any) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps/${erpId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const parsed = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'ERP connector updated');
        return parsed;
      } catch (e: any) {
        toastGlobal('error', 'ERP update failed', e.message || String(e));
        throw e;
      }
    });
  };
  const removeTenantErp = async (tenantId: string, erpId: string) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth(`/api/tenants/${tenantId}/erps/${erpId}`, { method: 'DELETE' });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'ERP connector removed');
        return data;
      } catch (e: any) {
        toastGlobal('error', 'Failed to remove ERP', e.message || String(e));
        throw e;
      }
    });
  };
  const createTenantUser = async (userData: { email: string; password: string; name: string; role?: string; organization?: string; tenantId: string }) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userData),
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'User created', `${userData.name} (${userData.email})`);
        return data;
      } catch (e: any) {
        toastGlobal('error', 'Failed to create user', e.message || String(e));
        throw e;
      }
    });
  };

  const updateInvoice = async (invoiceId: string, data: any) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth(`/api/invoices/${invoiceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const parsed = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Invoice updated', data?.clientInvoiceNumber || invoiceId);
        return parsed;
      } catch (e: any) {
        toastGlobal('error', 'Invoice update failed', e.message || String(e));
        throw e;
      }
    });
  };

  const purgeDemoData = async () => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/system/purge-demo-data', { method: 'POST' });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Staging purge complete', `${data?.deletedInvoices ?? ''} invoices cleared`);
        return data;
      } catch (e: any) {
        console.error('Purge test data error:', e);
        toastGlobal('error', 'Purge failed', e.message || String(e));
        throw e;
      }
    });
  };

  const retryInvoice = async (invoiceId: string) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth(`/api/invoices/${invoiceId}/retry`, { method: 'POST' });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', 'Retry queued', `Invoice re-queued for CittaEFS stamping (job ${data.jobId || ''})`);
        return data;
      } catch (e:any) {
        toastGlobal('error', 'Retry failed', e.message || String(e));
        throw e;
      }
    });
  };
  const retryBulkInvoices = async (tenantId?: string, invoiceIds?: string[]) => {
    return withLoading(async () => {
      try {
        const targetTenantId = tenantId || activeTenantId;
        const res = await fetchWithAuth('/api/invoices/retry-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: targetTenantId, invoiceIds })
        });
        const data = await parseJsonResponse(res);
        await refreshAll();
        toastGlobal('success', `Retried ${data.retried || 0}/${data.total || 0} invoices`, data.message || '');
        return data;
      } catch (e:any) {
        toastGlobal('error', 'Bulk retry failed', e.message || String(e));
        throw e;
      }
    });
  };
  const getRetryStatus = async (invoiceId: string) => {
    const res = await fetchWithAuth(`/api/invoices/retry-status/${invoiceId}`);
    return parseJsonResponse(res);
  };

  return (
    <HubContext.Provider
      value={{
        currentUser,
        login,
        logout,
        activeTenantId,
        setActiveTenantId,
        activeTenant,
        tenants,
        invoices,
        customers,
        itemMappings,
        validationErrors,
        auditLogs,
        metrics,
        isBgRefreshing,
        isInitialized,
        refreshAll,
        transmitInvoice,
        cancelInvoice,
        resolveValidationError,
        runReconciliationCron,
        autoMapItems,
        addCustomer,
        addItemMapping,
        ingestCsvInvoices,
        onboardTenant,
        updateTenant,
        deleteTenant,
        bulkTransmitInvoices,
        tenantErps,
        addTenantErp,
        updateTenantErp,
        removeTenantErp,
        createTenantUser,
        updateInvoice,
        purgeDemoData,
        retryInvoice,
        retryBulkInvoices,
        getRetryStatus
      }}
    >
      {children}
    </HubContext.Provider>
  );
}

export function useHub() {
  const context = useContext(HubContext);
  if (!context) throw new Error('useHub must be used within HubProvider');
  return context;
}
