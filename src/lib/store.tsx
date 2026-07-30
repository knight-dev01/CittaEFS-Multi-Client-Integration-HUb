import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { fetchWithAuth } from './api';
import { 
  Tenant, 
  Invoice, 
  CustomerProfile, 
  ItemCodeMapping, 
  ValidationErrorItem, 
  AuditLog, 
  SystemMetrics,
  TenantId,
  UserSession 
} from '../types';
import { 
  INITIAL_TENANTS, 
  INITIAL_INVOICES, 
  INITIAL_CUSTOMERS, 
  INITIAL_ITEM_MAPPINGS, 
  INITIAL_VALIDATION_ERRORS, 
  INITIAL_AUDIT_LOGS, 
  INITIAL_METRICS 
} from '../data/mockData';

interface HubContextType {
  currentUser: UserSession | null;
  login: (session: UserSession) => void;
  logout: () => void;
  activeTenantId: TenantId;
  setActiveTenantId: (id: TenantId) => void;
  activeTenant: Tenant;
  tenants: Tenant[];
  invoices: Invoice[];
  customers: CustomerProfile[];
  itemMappings: ItemCodeMapping[];
  validationErrors: ValidationErrorItem[];
  auditLogs: AuditLog[];
  metrics: SystemMetrics;
  isBgRefreshing: boolean;
  
  // Actions
  refreshAll: () => Promise<void>;
  transmitInvoice: (payload: any) => Promise<any>;
  cancelInvoice: (invoiceId: string, reason: string) => Promise<any>;
  resolveValidationError: (errorId: string, hsOrServiceCode?: string, correctedTin?: string) => Promise<any>;
  runReconciliationCron: () => Promise<any>;
  autoMapItems: () => Promise<any>;
  addCustomer: (cust: Partial<CustomerProfile>) => Promise<any>;
  addItemMapping: (mapping: Partial<ItemCodeMapping>) => Promise<any>;
  ingestCsvInvoices: (parsedInvoices: any[]) => Promise<any>;
  onboardTenant: (tenantData: any) => Promise<Tenant>;
  purgeDemoData: () => Promise<any>;
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
      fetchWithAuth('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.user) {
            const session: UserSession = {
              id: data.user.id,
              name: data.user.name,
              email: data.user.email,
              role: data.user.role,
              organization: data.user.organization,
              loginAt: new Date().toISOString()
            };
            setCurrentUser(session);
          } else {
            logout();
          }
        })
        .catch(() => {});
    }
  }, []);

  const login = (session: UserSession, token?: string) => {
    setCurrentUser(session);
    try {
      localStorage.setItem('cittaefs_user_session', JSON.stringify(session));
      if (token) {
        localStorage.setItem('citta_jwt_token', token);
      }
    } catch (e) {
      console.warn('Could not save session to localStorage', e);
    }
  };

  const logout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem('cittaefs_user_session');
      localStorage.removeItem('citta_jwt_token');
    } catch (e) {
      console.warn('Could not remove session from localStorage', e);
    }
  };

  const [activeTenantId, setActiveTenantId] = useState<TenantId>('tenant_qbo_smb');
  const [tenants, setTenants] = useState<Tenant[]>(INITIAL_TENANTS);
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [customers, setCustomers] = useState<CustomerProfile[]>(INITIAL_CUSTOMERS);
  const [itemMappings, setItemMappings] = useState<ItemCodeMapping[]>(INITIAL_ITEM_MAPPINGS);
  const [validationErrors, setValidationErrors] = useState<ValidationErrorItem[]>(INITIAL_VALIDATION_ERRORS);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);
  const [metrics, setMetrics] = useState<SystemMetrics>(INITIAL_METRICS);

  const activeTenant = tenants.find(t => t.id === activeTenantId) || tenants[0];

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
        const [tenRes, invRes, custRes, itemRes, errRes, auditRes, metRes] = await Promise.all([
          fetchWithAuth('/api/tenants').then(r => r.json()),
          fetchWithAuth('/api/invoices').then(r => r.json()),
          fetchWithAuth('/api/customers').then(r => r.json()),
          fetchWithAuth('/api/items/mappings').then(r => r.json()),
          fetchWithAuth('/api/validation-errors').then(r => r.json()),
          fetchWithAuth('/api/audit-logs').then(r => r.json()),
          fetchWithAuth('/api/metrics').then(r => r.json())
        ]);

        if (Array.isArray(tenRes)) setTenants(tenRes);
        if (Array.isArray(invRes)) setInvoices(invRes);
        if (Array.isArray(custRes)) setCustomers(custRes);
        if (Array.isArray(itemRes)) setItemMappings(itemRes);
        if (Array.isArray(errRes)) setValidationErrors(errRes);
        if (Array.isArray(auditRes)) setAuditLogs(auditRes);
        if (metRes && typeof metRes === 'object') setMetrics(metRes);
      } catch (e) {
        console.warn('Backend refresh fallback to local state:', e);
      }
    });
  };

  useEffect(() => {
    refreshAll();

    // Set up real-time listener systems: WebSockets & Server-Sent Events
    let eventSource: EventSource | null = null;
    let ws: WebSocket | null = null;
    let sseReconnectTimeout: any = null;
    let wsReconnectTimeout: any = null;

    const connectWS = () => {
      try {
        console.log('[WS] Attempting to connect to real-time events...');
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws-events`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('[WS] Connection successfully established.');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[WS] Received real-time broadcast:', data);
            if (data.type === 'update') {
              refreshAll();
            }
          } catch (e) {
            console.warn('[WS] Error processing event data:', e);
          }
        };

        ws.onerror = (err) => {
          console.warn('[WS] WebSocket encountered an error:', err);
        };

        ws.onclose = () => {
          console.log('[WS] WebSocket closed. Reconnecting in 5s...');
          if (ws) {
            ws.close();
            ws = null;
          }
          wsReconnectTimeout = setTimeout(connectWS, 5000);
        };
      } catch (err) {
        console.warn('[WS] Connection error:', err);
        wsReconnectTimeout = setTimeout(connectWS, 5000);
      }
    };

    const connectSSE = () => {
      console.log('[SSE] Attempting to connect to real-time events...');
      eventSource = new EventSource('/api/events');

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[SSE] Received real-time broadcast:', data);
          if (data.type === 'update') {
            refreshAll();
          }
        } catch (e) {
          console.warn('[SSE] Error processing event data:', e);
        }
      };

      eventSource.onerror = (err) => {
        console.warn('[SSE] EventSource failed, scheduling reconnect...', err);
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        sseReconnectTimeout = setTimeout(connectSSE, 5000); // Backoff retry
      };
    };

    connectWS();
    connectSSE();

    // Backup polling loop as fallback (every 8 seconds)
    const backupPoll = setInterval(() => {
      refreshAll();
    }, 8000);

    return () => {
      if (eventSource) eventSource.close();
      if (ws) ws.close();
      if (sseReconnectTimeout) clearTimeout(sseReconnectTimeout);
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
      clearInterval(backupPoll);
    };
  }, []);

  const transmitInvoice = async (payload: any) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/integration/gen/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, tenantId: activeTenantId })
        });
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Transmission error:', e);
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
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Cancel error:', e);
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
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Resolve error:', e);
        throw e;
      }
    });
  };

  const runReconciliationCron = async () => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/cron/reconcile', { method: 'POST' });
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Reconciliation error:', e);
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
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Auto map error:', e);
        throw e;
      }
    });
  };

  const addCustomer = async (cust: Partial<CustomerProfile>) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cust, tenantId: activeTenantId })
        });
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Add customer error:', e);
        throw e;
      }
    });
  };

  const addItemMapping = async (mapping: Partial<ItemCodeMapping>) => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/items/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...mapping, tenantId: activeTenantId })
        });
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Add item mapping error:', e);
        throw e;
      }
    });
  };

  const ingestCsvInvoices = async (parsedInvoices: any[]) => {
    for (const inv of parsedInvoices) {
      await transmitInvoice(inv);
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
        const data: Tenant = await res.json();
        await refreshAll();
        if (data && data.id) {
          setActiveTenantId(data.id);
        }
        return data;
      } catch (e) {
        console.error('Onboard tenant error:', e);
        throw e;
      }
    });
  };

  const purgeDemoData = async () => {
    return withLoading(async () => {
      try {
        const res = await fetchWithAuth('/api/system/purge-demo-data', { method: 'POST' });
        const data = await res.json();
        await refreshAll();
        return data;
      } catch (e) {
        console.error('Purge demo data error:', e);
        throw e;
      }
    });
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
        purgeDemoData
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
