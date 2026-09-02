import { useState, useEffect } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { useHub } from '../lib/store';
import { toastGlobal } from './ui/Toast';
import {
  Plug,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Plus,
  ShieldCheck,
  FileSpreadsheet,
  Globe,
  Zap
} from 'lucide-react';
import { Connector } from '../types';
import { NewConnectorModal } from './NewConnectorModal';
import { QboStagingInbox } from './QboStagingInbox';

interface ConnectorStatus {
  qbo: { connected: boolean; status: string; companyId: string | null; lastSyncAt: string | null };
  excelCsv: { totalInvoices: number; lastInvoiceAt: string | null };
  cittaGateway: { totalStamped: number; totalPending: number; totalRejected: number };
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

export function ConnectorsTab() {
  const { activeTenant } = useHub();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [testingQbo, setTestingQbo] = useState(false);
  const [syncingQbo, setSyncingQbo] = useState(false);

  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const qboRedirectStatus = queryParams.get('qbo');
  const qboRedirectRealmId = queryParams.get('realmId');
  const qboRedirectError = queryParams.get('error') || queryParams.get('message');
  const isQboDisconnectedNotice = queryParams.get('qbo') === 'disconnected';
  const isQboConnectNotice = queryParams.get('connect') === 'qbo' || (typeof window !== 'undefined' && window.location.pathname === '/connect-quickbooks');

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await fetchWithAuth(`/api/connectors/status?tenantId=${activeTenant.id}`);
      const data = await parseJsonResponse(res);
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  useEffect(() => {
    if (qboRedirectStatus === 'success' || qboRedirectStatus === 'error') {
      loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qboRedirectStatus]);

  const handleSyncQbo = async () => {
    setSyncingQbo(true);
    try {
      const res = await fetchWithAuth('/api/integrations/qbo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setSyncingQbo(false);
      if (data.success) {
        toastGlobal('success', 'QuickBooks sync complete', `Found ${data.totalFound} · New ${data.newSynced} · Already synced ${data.alreadySynced}`);
      } else {
        toastGlobal('error', 'Sync failed', data.error || 'Unknown error');
      }
      await loadStatus();
    } catch (err: any) {
      setSyncingQbo(false);
      const isReauth = err.message?.toLowerCase().includes('reauthorization');
      if (isReauth && confirm(`QuickBooks needs reauthorization:\n${err.message}\n\nReconnect now?`)) {
        window.location.href = `/api/integrations/qbo/connect?tenantId=${activeTenant.id}`;
        return;
      }
      toastGlobal('error', 'Sync error', err.message);
      await loadStatus();
    }
  };

  const handleTestQbo = async () => {
    setTestingQbo(true);
    try {
      const res = await fetchWithAuth('/api/connectors/qbo/test-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id })
      });
      const data = await parseJsonResponse(res);
      setTestingQbo(false);
      if (data.success) {
        toastGlobal('success', 'Live QuickBooks test passed', `Company: ${data.companyInfo?.CompanyName} · ${data.companyInfo?.Country} · ${data.latencyMs}ms`);
      } else {
        toastGlobal('error', 'Connection test failed', data.error || 'Unknown error');
      }
      await loadStatus();
    } catch (err: any) {
      setTestingQbo(false);
      toastGlobal('error', 'API error testing connector', err.message);
    }
  };

  const handleAddConnector = (newConn: Connector) => {
    toastGlobal('info', `${newConn.platform} noted`, 'Only QuickBooks Online and Excel/CSV are live in this release — other adapters are coming soon.');
  };

  return (
    <div className="space-y-6 font-sans text-xs">

      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Plug className="w-5 h-5 text-indigo-400" />
            QuickBooks Online & Excel Connectors Hub
            <span className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              QBO + EXCEL ACTIVE
            </span>
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Active Connectors: QuickBooks Online (OAuth2) & Excel/CSV Upload • Other adapters (SAP, NetSuite, SQL) frozen for future release • Workspace: <strong className="text-white font-medium">{activeTenant.name}</strong>
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-2 shrink-0 transition-colors"
        >
          <Plus className="w-4 h-4 text-indigo-200" />
          <span>Add New Connector</span>
        </button>
      </div>

      {/* QuickBooks OAuth Callback Result */}
      {qboRedirectStatus === 'success' && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-4 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
          <div className="flex items-start space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold text-emerald-950">QuickBooks Online Connected Successfully</strong>
              <p className="mt-0.5 text-emerald-800">
                Authorization completed for <strong>{activeTenant.name}</strong>
                {qboRedirectRealmId ? <>. Realm ID: <span className="font-mono">{qboRedirectRealmId}</span></> : '.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleSyncQbo}
            disabled={syncingQbo}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg cursor-pointer text-xs shrink-0 transition-colors shadow-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingQbo ? 'animate-spin' : ''}`} />
            <span>{syncingQbo ? 'Syncing...' : 'Sync Historical Data'}</span>
          </button>
        </div>
      )}

      {qboRedirectStatus === 'error' && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-xl p-4 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold text-rose-950">QuickBooks Authorization Failed</strong>
              <p className="mt-0.5 text-rose-800">{qboRedirectError || 'QuickBooks did not complete authorization. Please try again.'}</p>
            </div>
          </div>
          <button
            onClick={() => {
              window.location.href = `/api/integrations/qbo/connect?tenantId=${encodeURIComponent(activeTenant.id)}`;
            }}
            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg cursor-pointer text-xs shrink-0 transition-colors shadow-sm"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Intuit Disconnect Route Banner */}
      {isQboDisconnectedNotice && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <strong className="font-semibold text-amber-950">QuickBooks Disconnect Notice:</strong>
              <p className="mt-0.5 text-amber-800">Your QuickBooks Online app session was disconnected from Intuit. To restore automated CDC webhooks & IRN writebacks, please click "+ Add New Connector Adapter" to re-authenticate.</p>
            </div>
          </div>
        </div>
      )}

      {/* Intuit Connect / Reconnect Route Banner */}
      {isQboConnectNotice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-4 text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-3">
            <Zap className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <strong className="font-semibold text-emerald-950">Intuit Authorization Request:</strong>
              <p className="mt-0.5 text-emerald-800">You arrived via QuickBooks App Store integration link. Click "+ Add New Connector Adapter" or select QuickBooks Online below to initiate OAuth 2.0 grant.</p>
            </div>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg cursor-pointer text-xs shrink-0 transition-colors shadow-sm"
          >
            Authorize QBO Now
          </button>
        </div>
      )}

      {/* Connector Health Grid — real, DB-backed status */}
      {isLoadingStatus ? (
        <div className="p-8 text-center text-slate-400 text-xs">Loading connector status...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* QuickBooks Online — real Integration status */}
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold text-slate-900 text-sm">QuickBooks Online</span>
              </div>
              <span className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-full ${
                status?.qbo.connected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                {status?.qbo.status || 'NOT_CONNECTED'}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Auth Scheme:</span>
                <span className="font-medium text-slate-900">OAuth 2.0 (Auto-Refresh)</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Realm / Company ID:</span>
                <span className="font-mono font-medium text-slate-900">{status?.qbo.companyId || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Last Sync:</span>
                <span className="font-medium text-slate-900">{formatWhen(status?.qbo.lastSyncAt ?? null)}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2 text-xs">
              <button
                onClick={handleSyncQbo}
                disabled={syncingQbo}
                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-lg border border-indigo-200 inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${syncingQbo ? 'animate-spin' : ''}`} />
                <span>{syncingQbo ? 'Syncing...' : 'Sync Now'}</span>
              </button>
              <button
                onClick={handleTestQbo}
                disabled={testingQbo}
                className="font-semibold text-xs hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50 text-indigo-600 hover:text-indigo-700"
              >
                <RefreshCw className={`w-3 h-3 ${testingQbo ? 'animate-spin' : ''}`} />
                <span>{testingQbo ? 'Testing...' : 'Test (Live)'}</span>
              </button>
            </div>
          </div>

          {/* Excel & CSV Import — real tenant invoice counts (all channels, honestly labeled) */}
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span className="font-semibold text-slate-900 text-sm">Excel & CSV Import</span>
              </div>
              <span className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ACTIVE
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Protocol:</span>
                <span className="font-medium text-slate-900">SheetJS / Direct Upload</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Total Invoices (Tenant):</span>
                <span className="font-mono font-medium text-slate-900">{status?.excelCsv.totalInvoices ?? 0}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Last Invoice Ingested:</span>
                <span className="font-medium text-slate-900">{formatWhen(status?.excelCsv.lastInvoiceAt ?? null)}</span>
              </div>
            </div>

            <p className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed">
              Reflects all invoices on this tenant's ledger, across every ingestion channel — spreadsheet upload has no standing connection to test independently.
            </p>
          </div>

          {/* CittaEFS Gateway — real stamping outcomes from the signing queue */}
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold text-slate-900 text-sm">CittaEFS Gateway</span>
              </div>
              <span className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ACTIVE
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>NRS Stamped (Approved):</span>
                <span className="font-mono font-medium text-emerald-600">{status?.cittaGateway.totalStamped ?? 0}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Pending NRS Stamp:</span>
                <span className="font-mono font-medium text-amber-600">{status?.cittaGateway.totalPending ?? 0}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Rejected (Retries Exhausted):</span>
                <span className="font-mono font-medium text-rose-600">{status?.cittaGateway.totalRejected ?? 0}</span>
              </div>
            </div>

            <p className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed">
              Live counts from the invoice signing queue's real outcomes for this tenant — not a synthetic endpoint ping.
            </p>
          </div>

        </div>
      )}

      {/* QBO Staging Inbox — preview before CittaEFS (DocNumber truth + autoEnqueue toggle) */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
        <QboStagingInbox tenantId={activeTenant.id} />
      </div>

      {/* Adapter Architecture Summary */}
      <div className="bg-emerald-50/60 rounded-xl border border-emerald-200/80 p-5 space-y-2">
        <div className="flex items-center gap-2 font-bold text-emerald-800">
          <Globe className="w-4 h-4 text-emerald-600" />
          <span>Active: QuickBooks Online & Excel/CSV Connectors</span>
        </div>
        <p className="text-emerald-700 text-xs leading-relaxed">
          <strong>Currently Active:</strong> QuickBooks Online (OAuth2 REST/Webhook) and Excel/CSV File Upload adapters are fully operational.
          <br/><strong>Frozen for future release:</strong> SAP S/4HANA, NetSuite SuiteTalk, Custom SQL Staging, Odoo ERP, and Sage ERP adapters.
        </p>
      </div>

      {/* New Connector Multi-Step Modal */}
      <NewConnectorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tenantId={activeTenant.id}
        tenantName={activeTenant.name}
        onAddConnector={handleAddConnector}
      />

    </div>
  );
}
