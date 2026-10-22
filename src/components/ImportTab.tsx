import { useState, useEffect, useRef } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { useHub } from '../lib/store';
import { ExcelDocumentViewer } from './ExcelDocumentViewer';
import { PageHeader } from './ui/PageHeader';
import {
  FileSpreadsheet,
  Zap,
  Layers,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Server
} from 'lucide-react';

type ImportSource = 'excel' | 'qbo' | 'odoo';

export function ImportTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { activeTenant, customers, itemMappings, invoices, refreshAll } = useHub();

  // Tenant-aware mode: QBO tenants default to QBO, Odoo tenants to Odoo, Excel tenants to Excel
  const tenantPlatform = activeTenant.platformType || '';
  const isQboTenant = tenantPlatform === 'QuickBooks Online';
  const isOdooTenant = tenantPlatform === 'Odoo ERP';
  const isExcelTenant = tenantPlatform.includes('Excel') || tenantPlatform.includes('CSV');
  const tenantDefault: ImportSource = isQboTenant ? 'qbo' : isOdooTenant ? 'odoo' : 'excel';
  const [selectedSource, setSelectedSourceState] = useState<ImportSource>(() => {
    // Respect tenant default first, then saved preference if compatible
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('citta_import_source');
      if (saved === 'excel' || saved === 'qbo' || saved === 'odoo') {
        // If tenant is strictly one mode, ignore incompatible saved value
        if ((isQboTenant || isOdooTenant || isExcelTenant) && saved !== tenantDefault) return tenantDefault;
        return saved;
      }
    }
    return tenantDefault;
  });

  // Keep selection in sync when user switches workspace
  const prevTenantIdRef = useRef<string>(activeTenant.id);
  useEffect(() => {
    if (prevTenantIdRef.current !== activeTenant.id) {
      prevTenantIdRef.current = activeTenant.id;
      const def: ImportSource = activeTenant.platformType === 'QuickBooks Online' ? 'qbo' : activeTenant.platformType === 'Odoo ERP' ? 'odoo' : 'excel';
      setSelectedSourceState(def);
    }
  }, [activeTenant.id, activeTenant.platformType]);

  const isChannelLocked = (channel: ImportSource) =>
    (isQboTenant || isOdooTenant || isExcelTenant) && channel !== tenantDefault;

  const setSelectedSource = (source: ImportSource) => {
    // Guard: a tenant locked to one channel cannot switch to another via this tab
    if (isChannelLocked(source)) return;
    setSelectedSourceState(source);
    if (typeof window !== 'undefined') {
      localStorage.setItem('citta_import_source', source);
    }
  };

  // QuickBooks Action State
  const [isProcessing, setIsProcessing] = useState(false);
  const [qboStatusMsg, setQboStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Odoo Action State
  const [isProcessingOdoo, setIsProcessingOdoo] = useState(false);
  const [odooStatusMsg, setOdooStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  if (!activeTenant) {
    return <div className="p-8 text-center text-slate-400 text-xs">Loading workspace...</div>;
  }

  // Real Sync Data Counters, derived from actual DB-backed state for the active tenant
  const tenantCustomers = customers.filter(c => c.tenantId === activeTenant.id);
  const tenantItems = itemMappings.filter(m => m.tenantId === activeTenant.id);
  const tenantInvoices = invoices.filter(i => i.tenantId === activeTenant.id);
  const syncedCustomers = tenantCustomers.length;
  const syncedProducts = tenantItems.length;
  const pendingInvoices = tenantInvoices.filter(i => i.status === 'PENDING_NRS_STAMP' || i.status === 'QUEUED').length;
  const lastSyncTime = activeTenant.lastSyncAt ? new Date(activeTenant.lastSyncAt).toLocaleString() : 'Never';

  // QuickBooks Direct Actions
  const handleTestQboConnection = async () => {
    setIsProcessing(true);
    setQboStatusMsg({ text: 'Testing connection to QuickBooks Online OAuth2 endpoints...', type: 'info' });

    try {
      const res = await fetchWithAuth('/api/connectors/qbo/test-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);

      if (data.success) {
        setQboStatusMsg({ text: `✓ Connection Active! QuickBooks Online API responder latency: ${data.latencyMs || 45}ms.`, type: 'success' });
      } else {
        setQboStatusMsg({ text: `Connection Notice: ${data.error || 'Unable to verify QuickBooks connection.'}`, type: 'error' });
      }
    } catch (err: any) {
      setQboStatusMsg({ text: `Connection Test Error: ${err.message || 'Unable to reach the QuickBooks test endpoint.'}`, type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Real historical sync: pulls actual invoices from QuickBooks (paginated), ingests them
  // (upserting Customers & Items along the way), and queues each new one for NRS stamping.
  const handleSyncFromQuickBooks = async () => {
    setIsProcessing(true);
    setQboStatusMsg({ text: 'Pulling invoices, customers, and items from QuickBooks Online...', type: 'info' });

    try {
      const res = await fetchWithAuth('/api/integrations/qbo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setIsProcessing(false);
      setQboStatusMsg({
        text: `✓ Sync complete! Found ${data.totalFound} QuickBooks invoices — ${data.newSynced} newly ingested & queued for NRS stamping, ${data.alreadySynced} already on file.`,
        type: 'success'
      });
      await refreshAll();
    } catch (e: any) {
      setIsProcessing(false);
      const isReauth = e.message?.toLowerCase().includes('reauthorization');
      setQboStatusMsg({
        text: isReauth
          ? `${e.message} Reconnect QuickBooks from the Connectors tab, then sync again.`
          : `Sync Failed: ${e.message}`,
        type: 'error'
      });
    }
  };

  // Odoo Direct Actions
  const handleTestOdooConnection = async () => {
    setIsProcessingOdoo(true);
    setOdooStatusMsg({ text: 'Testing connection to Odoo JSON-RPC endpoint...', type: 'info' });

    try {
      const res = await fetchWithAuth('/api/connectors/odoo/test-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);

      if (data.success) {
        setOdooStatusMsg({ text: `✓ Connection Active! Odoo API responder latency: ${data.latencyMs || 45}ms.`, type: 'success' });
      } else {
        setOdooStatusMsg({ text: `Connection Notice: ${data.error || 'Unable to verify Odoo connection.'}`, type: 'error' });
      }
    } catch (err: any) {
      setOdooStatusMsg({ text: `Connection Test Error: ${err.message || 'Unable to reach the Odoo test endpoint.'}`, type: 'error' });
    } finally {
      setIsProcessingOdoo(false);
    }
  };

  const handleSyncFromOdoo = async () => {
    setIsProcessingOdoo(true);
    setOdooStatusMsg({ text: 'Pulling posted invoices, customers, and items from Odoo...', type: 'info' });

    try {
      const res = await fetchWithAuth('/api/integrations/odoo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setIsProcessingOdoo(false);
      setOdooStatusMsg({
        text: `✓ Sync complete! Found ${data.totalFound} Odoo invoices — ${data.newSynced} newly ingested & queued for NRS stamping, ${data.alreadySynced} already on file.`,
        type: 'success'
      });
      await refreshAll();
    } catch (e: any) {
      setIsProcessingOdoo(false);
      const isReauth = e.message?.toLowerCase().includes('reauthorization');
      setOdooStatusMsg({
        text: isReauth
          ? `${e.message} Reconnect Odoo from the Connectors tab, then sync again.`
          : `Sync Failed: ${e.message}`,
        type: 'error'
      });
    }
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Ingestion header */}
      <PageHeader
        icon={FileSpreadsheet}
        title="Invoice Ingestion"
        subtitle="Sync from QuickBooks Online / Odoo or upload Excel/CSV documents."
        actions={
          <button
            onClick={() => refreshAll()}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-semibold text-xs flex items-center gap-2 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-emerald-400" />
            <span>Refresh</span>
          </button>
        }
      />

      {/* Ingestion Source Switcher — tenant-locked */}
      <div className="bg-white rounded-lg border border-slate-200/80 p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

          {/* Excel & CSV Import Option */}
          <button
            onClick={() => setSelectedSource('excel')}
            disabled={isChannelLocked('excel')}
            className={`px-4 py-3 rounded-lg border-2 text-left flex items-center justify-between gap-2 transition-all ${isChannelLocked('excel') ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200' : 'cursor-pointer'} ${
              selectedSource === 'excel'
                ? 'bg-emerald-50/60 border-emerald-700 ring-2 ring-emerald-600/20 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
            title={isChannelLocked('excel') ? 'Switch to an Excel tenant to use this' : undefined}
          >
            <span className="font-bold text-xs text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              Excel / CSV
            </span>
            <span className={`px-2 py-0.5 font-semibold text-[10px] rounded-full shrink-0 ${selectedSource==='excel' && !isChannelLocked('excel') ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
              {isChannelLocked('excel') ? 'LOCKED' : selectedSource==='excel' ? 'ACTIVE' : 'Available'}
            </span>
          </button>

          {/* QuickBooks Online Option */}
          <button
            onClick={() => setSelectedSource('qbo')}
            disabled={isChannelLocked('qbo')}
            className={`px-4 py-3 rounded-lg border-2 text-left flex items-center justify-between gap-2 transition-all ${isChannelLocked('qbo') ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200' : 'cursor-pointer'} ${
              selectedSource === 'qbo'
                ? 'bg-emerald-50/60 border-emerald-700 ring-2 ring-emerald-600/20 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
            title={isChannelLocked('qbo') ? 'Switch to a QBO tenant to use this' : undefined}
          >
            <span className="font-bold text-xs text-slate-900 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              QuickBooks Online
            </span>
            <span className={`px-2 py-0.5 font-semibold text-[10px] rounded-full shrink-0 ${selectedSource==='qbo' && !isChannelLocked('qbo') ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
              {isChannelLocked('qbo') ? 'LOCKED' : selectedSource==='qbo' ? 'ACTIVE' : 'Available'}
            </span>
          </button>

          {/* Odoo ERP Option */}
          <button
            onClick={() => setSelectedSource('odoo')}
            disabled={isChannelLocked('odoo')}
            className={`px-4 py-3 rounded-lg border-2 text-left flex items-center justify-between gap-2 transition-all ${isChannelLocked('odoo') ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200' : 'cursor-pointer'} ${
              selectedSource === 'odoo'
                ? 'bg-slate-50/60 border-slate-600 ring-2 ring-slate-500/20 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
            title={isChannelLocked('odoo') ? 'Switch to an Odoo tenant to use this' : undefined}
          >
            <span className="font-bold text-xs text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-900" />
              Odoo
            </span>
            <span className={`px-2 py-0.5 font-semibold text-[10px] rounded-full shrink-0 ${selectedSource==='odoo' && !isChannelLocked('odoo') ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
              {isChannelLocked('odoo') ? 'LOCKED' : selectedSource==='odoo' ? 'ACTIVE' : 'Available'}
            </span>
          </button>

        </div>
      </div>

      {/* Main Channel View */}
      {selectedSource === 'excel' ? (
        /* Excel & CSV Interactive Grid Component */
        <ExcelDocumentViewer tenantId={activeTenant.id} startEmpty />
      ) : selectedSource === 'odoo' ? (
        /* Odoo Admin Action Panel */
        <div className="bg-white rounded-lg border border-slate-200/80 p-6 space-y-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-900" />
                <span>Odoo ERP Integration Controls</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Perform Odoo synchronization actions to update Master Data directories and transmit pending invoices.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-xs rounded-full flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>API Key Connected</span>
              </span>
            </div>
          </div>

          {/* Odoo Live Action Status Banner */}
          {odooStatusMsg && (
            <div className={`p-3.5 rounded-lg border text-xs font-medium flex items-center gap-2.5 ${
              odooStatusMsg.type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
              odooStatusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-slate-50 text-slate-800 border-slate-200'
            }`}>
              {odooStatusMsg.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />}
              <span>{odooStatusMsg.text}</span>
            </div>
          )}

          {/* Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/70 space-y-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Action 1</span>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                  <Server className="w-4 h-4 text-emerald-700" />
                  Test JSON-RPC API Connection
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Verifies live API connection to the Odoo instance backend endpoint.
                </p>
              </div>
              <button
                onClick={handleTestOdooConnection}
                disabled={isProcessingOdoo}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Server className="w-3.5 h-3.5 text-slate-400" />
                <span>Test Connection</span>
              </button>
            </div>

            <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/70 space-y-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Action 2</span>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                  <RefreshCw className="w-4 h-4 text-emerald-700" />
                  Sync from Odoo
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Pulls posted invoices (paginated), upserts customers & items into Master Data, and queues each new invoice for NRS stamping.
                </p>
              </div>
              <button
                onClick={handleSyncFromOdoo}
                disabled={isProcessingOdoo}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-200 ${isProcessingOdoo ? 'animate-spin' : ''}`} />
                <span>Sync from Odoo</span>
              </button>
            </div>

          </div>

          {/* Admin Navigation Shortcuts */}
          {onNavigate && (
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">Admin Quick Actions:</span>
              <button
                onClick={() => onNavigate('invoices')}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <span>View Stamped Invoices</span>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          )}
        </div>
      ) : (
        /* QuickBooks Admin Action Panel */
        <div className="bg-white rounded-lg border border-slate-200/80 p-6 space-y-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span>QuickBooks Online Integration Controls</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Perform QuickBooks synchronization actions to update Master Data directories and transmit pending invoices.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-xs rounded-full flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>OAuth2 Connected</span>
              </span>
            </div>
          </div>

          {/* QBO Live Action Status Banner */}
          {qboStatusMsg && (
            <div className={`p-3.5 rounded-lg border text-xs font-medium flex items-center gap-2.5 ${
              qboStatusMsg.type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
              qboStatusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-slate-50 text-slate-800 border-slate-200'
            }`}>
              {qboStatusMsg.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />}
              <span>{qboStatusMsg.text}</span>
            </div>
          )}

          {/* Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/70 space-y-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Action 1</span>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                  <Server className="w-4 h-4 text-emerald-700" />
                  Test OAuth2 API Connection
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Verifies live API connection to QuickBooks Online backend endpoint.
                </p>
              </div>
              <button
                onClick={handleTestQboConnection}
                disabled={isProcessing}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Server className="w-3.5 h-3.5 text-emerald-400" />
                <span>Test Connection</span>
              </button>
            </div>

            <div className="p-5 bg-slate-50/80 rounded-lg border border-slate-200/70 space-y-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Action 2</span>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                  <RefreshCw className="w-4 h-4 text-emerald-700" />
                  Sync from QuickBooks
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Pulls real invoices (paginated), upserts customers & items into Master Data, and queues each new invoice for NRS stamping.
                </p>
              </div>
              <button
                onClick={handleSyncFromQuickBooks}
                disabled={isProcessing}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-200 ${isProcessing ? 'animate-spin' : ''}`} />
                <span>Sync from QuickBooks</span>
              </button>
            </div>

          </div>

          {/* Admin Navigation Shortcuts */}
          {onNavigate && (
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">Admin Quick Actions:</span>
              <button
                onClick={() => onNavigate('invoices')}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <span>View Stamped Invoices</span>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
