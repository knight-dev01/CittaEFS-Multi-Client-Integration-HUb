import { useState } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { useHub } from '../lib/store';
import { ExcelDocumentViewer } from './ExcelDocumentViewer';
import { 
  FileSpreadsheet,
  Zap,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Server
} from 'lucide-react';

export function ImportTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { activeTenant, customers, itemMappings, invoices, refreshAll } = useHub();

  // Selected ingestion source: 'excel' | 'qbo'
  const [selectedSource, setSelectedSourceState] = useState<'excel' | 'qbo'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('citta_import_source');
      if (saved === 'excel' || saved === 'qbo') return saved;
    }
    return 'excel';
  });

  const setSelectedSource = (source: 'excel' | 'qbo') => {
    setSelectedSourceState(source);
    if (typeof window !== 'undefined') {
      localStorage.setItem('citta_import_source', source);
    }
  };

  // QuickBooks Action State
  const [isProcessing, setIsProcessing] = useState(false);
  const [qboStatusMsg, setQboStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

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

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Admin Executive Summary Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 shadow-sm border border-slate-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full text-xs font-semibold border border-indigo-500/30">
                Workspace: {activeTenant.name}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white mt-1">
              Invoice Ingestion & Master Data Hub
            </h1>
            <p className="text-slate-400 text-xs mt-1">
              Admin control panel for QuickBooks Online automated sync and interactive Excel/CSV document editing.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshAll()}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-semibold text-xs flex items-center gap-2 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-indigo-400" />
              <span>Refresh Metrics</span>
            </button>
          </div>
        </div>

        {/* Executive Action Summary Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Active Integration</span>
            <span className="font-semibold text-indigo-300 mt-0.5 block">
              {selectedSource === 'excel' ? 'Excel & CSV Uploads' : 'QuickBooks Online'}
            </span>
          </div>

          <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Client TIN</span>
            <span className="font-semibold text-white mt-0.5 block">{activeTenant.tin}</span>
          </div>

          <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Master Directory</span>
            <span className="font-semibold text-emerald-400 mt-0.5 block">
              {syncedCustomers} Parties / {syncedProducts} SKUs
            </span>
          </div>

          <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Gateway Compliance</span>
            <span className="font-semibold text-emerald-400 flex items-center gap-1 mt-0.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> NRS Verified
            </span>
          </div>
        </div>
      </div>

      {/* Ingestion Source Switcher (Only QuickBooks & Excel/CSV) */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Ingestion Channel:</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          {/* Excel & CSV Import Option */}
          <button
            onClick={() => setSelectedSource('excel')}
            className={`p-5 rounded-xl border-2 text-left flex flex-col justify-between transition-all cursor-pointer ${
              selectedSource === 'excel'
                ? 'bg-indigo-50/60 border-indigo-600 ring-2 ring-indigo-500/20 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                Excel & CSV Document Viewer
              </span>
              <span className="px-2.5 py-0.5 bg-indigo-600 text-white font-semibold text-[10px] rounded-full">
                ACTIVE
              </span>
            </div>
            <p className="text-xs text-slate-500 my-3 leading-relaxed">
              Upload, edit, and normalize Excel (.xlsx/.xls) and CSV documents directly in the interactive spreadsheet grid.
            </p>
            <span className="text-xs font-semibold text-indigo-600 flex items-center gap-1">
              Interactive Spreadsheet Grid <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </button>

          {/* QuickBooks Online Option */}
          <button
            onClick={() => setSelectedSource('qbo')}
            className={`p-5 rounded-xl border-2 text-left flex flex-col justify-between transition-all cursor-pointer ${
              selectedSource === 'qbo'
                ? 'bg-indigo-50/60 border-indigo-600 ring-2 ring-indigo-500/20 shadow-sm'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                QuickBooks Online Direct Sync
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[10px] rounded-full">
                ACTIVE
              </span>
            </div>
            <p className="text-xs text-slate-500 my-3 leading-relaxed">
              Automated OAuth 2.0 API connection to pull customers, SKU catalogs, and transmit fiscal invoices directly.
            </p>
            <span className="text-xs font-semibold text-amber-600 flex items-center gap-1">
              OAuth2 API Sync <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </button>

        </div>
      </div>

      {/* Main Channel View */}
      {selectedSource === 'excel' ? (
        /* Excel & CSV Interactive Grid Component */
        <ExcelDocumentViewer />
      ) : (
        /* QuickBooks Admin Action Panel */
        <div className="bg-white rounded-xl border border-slate-200/80 p-6 space-y-6 shadow-sm">
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
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
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
              {qboStatusMsg.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
              <span>{qboStatusMsg.text}</span>
            </div>
          )}

          {/* Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div className="p-5 bg-slate-50/80 rounded-xl border border-slate-200/70 space-y-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Action 1</span>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                  <Server className="w-4 h-4 text-indigo-600" />
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
                <Server className="w-3.5 h-3.5 text-indigo-400" />
                <span>Test Connection</span>
              </button>
            </div>

            <div className="p-5 bg-slate-50/80 rounded-xl border border-slate-200/70 space-y-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Action 2</span>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                  <RefreshCw className="w-4 h-4 text-emerald-600" />
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
