import { useState } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { useHub } from '../lib/store';
import { 
  Plug, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Plus, 
  ShieldCheck, 
  Activity, 
  Database,
  FileSpreadsheet,
  Globe,
  Server,
  Zap,
  Sliders
} from 'lucide-react';
import { Connector } from '../types';
import { NewConnectorModal } from './NewConnectorModal';

export function ConnectorsTab() {
  const { activeTenant } = useHub();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingQbo, setSyncingQbo] = useState(false);

  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const isQboDisconnectedNotice = queryParams.get('qbo') === 'disconnected';
  const isQboConnectNotice = queryParams.get('connect') === 'qbo' || (typeof window !== 'undefined' && window.location.pathname === '/connect-quickbooks');

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
        alert(`✅ QuickBooks Historical Sync Complete!\n\n• Total Invoices Found: ${data.totalFound}\n• New Invoices Synced: ${data.newSynced}\n• Already Synced (Idempotent): ${data.alreadySynced}`);
      } else if (data.reauthRequired || data.error?.toLowerCase().includes('reauthorization')) {
        const doReauth = confirm(`⚠️ QuickBooks Connection Needs Reauthorization!\n\n${data.error || 'Your QuickBooks Online OAuth session has expired or requires user re-authorization.'}\n\nWould you like to re-authorize QuickBooks Online now?`);
        if (doReauth) {
          window.location.href = `/api/integrations/qbo/connect?tenantId=${activeTenant.id}`;
        }
      } else {
        alert(`❌ Sync Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setSyncingQbo(false);
      alert(`❌ Sync Error: ${err.message}`);
    }
  };

  const [connectors, setConnectors] = useState<(Connector & { isComingSoon?: boolean })[]>([
    {
      id: 'conn_qbo_01',
      tenantId: activeTenant.id,
      platform: 'QuickBooks Online',
      type: 'REST API / Webhook',
      auth: 'OAuth 2.0 (Auto-Refresh)',
      status: 'HEALTHY',
      endpoint: 'https://quickbooks.api.intuit.com/v3/company/9130351112',
      latencyMs: 142,
      lastSync: '2 mins ago',
      syncedInvoices: 1842,
      environment: 'PRODUCTION',
      isComingSoon: false
    },
    {
      id: 'conn_excel_02',
      tenantId: activeTenant.id,
      platform: 'Excel & CSV Import (.xlsx, .csv)',
      type: 'Spreadsheet Parser / File Drop',
      auth: 'Schema Hash Validation',
      status: 'HEALTHY',
      endpoint: 's3://cittaefs-ingest-bucket/tenant-excel-drops/',
      latencyMs: 42,
      lastSync: '10 mins ago',
      syncedInvoices: 5210,
      environment: 'PRODUCTION',
      isComingSoon: false
    },
    {
      id: 'conn_efs_03',
      tenantId: activeTenant.id,
      platform: 'CittaEFS Gateway (CSL)',
      type: 'REST API / HMAC SHA-256',
      auth: 'X-CittaEFS-Signature',
      status: 'HEALTHY',
      endpoint: 'https://api.cittaefs.com/v1/taxation/stamp',
      latencyMs: 38,
      lastSync: 'Just now',
      syncedInvoices: 12450,
      environment: 'PRODUCTION',
      isComingSoon: false
    }
  ]);

  const handleAddConnector = (newConn: Connector) => {
    setConnectors([newConn, ...connectors]);
    alert(`Connector for ${newConn.platform} successfully registered and activated!`);
  };

  const handleTestExistingConnector = async (id: string, platformName: string, isComingSoon?: boolean) => {
    if (isComingSoon) {
      alert(`ℹ️ ${platformName} Adapter is COMING SOON in the upcoming release!\n\nNote: QuickBooks Online, Excel & CSV Import, and CittaEFS Gateway are currently ACTIVE and ready for live API testing and transmission to CittaEFS.`);
      return;
    }

    setTestingId(id);
    try {
      const isSage = platformName.includes('Sage');
      const url = isSage ? '/api/connectors/sage/test-live' : '/api/connectors/qbo/test-live';
      const res = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realmId: '9130351112',
          environment: 'PRODUCTION',
          endpointUrl: isSage ? 'https://api.sage.com/v3/company/91238' : 'https://sandbox-quickbooks.api.intuit.com/v3/company/9130351112'
        })
      });
      const data = await parseJsonResponse(res);
      setTestingId(null);

      if (data.success) {
        setConnectors(connectors.map(c => {
          if (c.id === id) {
            return { ...c, latencyMs: data.latencyMs, lastSync: 'Just now', status: 'HEALTHY' };
          }
          return c;
        }));
        alert(`✅ LIVE ${platformName.toUpperCase()} API TEST PASSED!\n\nPlatform: ${data.platform}\nEnvironment: ${data.environment}\nStatus: ${data.status}\nLatency: ${data.latencyMs} ms\nCDC Webhooks: ${data.cdcWebhooks}\nCompany: ${data.companyInfo?.CompanyName}`);
      } else {
        alert(`❌ Connection Test Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setTestingId(null);
      alert(`❌ API Error testing connector: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Plug className="w-5 h-5 text-indigo-400" />
            Pluggable ERP & Accounting Connectors Hub
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Active Adapter Architecture • Workspace: <strong className="text-white font-medium">{activeTenant.name}</strong> ({activeTenant.id})
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

      {/* Connector Health Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {connectors.map((conn) => (
          <div key={conn.id} className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                {conn.platform.includes('SQL') ? (
                  <Database className="w-4 h-4 text-indigo-600" />
                ) : conn.platform.includes('CSV') ? (
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                ) : conn.platform.includes('SAP') ? (
                  <Server className="w-4 h-4 text-indigo-600" />
                ) : conn.platform.includes('NetSuite') ? (
                  <Zap className="w-4 h-4 text-amber-500" />
                ) : (
                  <Globe className="w-4 h-4 text-indigo-600" />
                )}
                <span className="font-semibold text-slate-900 text-sm">{conn.platform}</span>
              </div>
              {conn.isComingSoon ? (
                <span className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  COMING SOON
                </span>
              ) : (
                <span className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-full ${
                  conn.status === 'HEALTHY' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {conn.status} (LIVE)
                </span>
              )}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Protocol:</span>
                <span className="font-medium text-slate-900">{conn.type}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Auth Scheme:</span>
                <span className="font-medium text-slate-900">{conn.auth}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Adapter Latency:</span>
                <span className="font-mono font-medium text-emerald-600">{conn.isComingSoon ? 'N/A' : `${conn.latencyMs} ms`}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Total Ingested:</span>
                <span className="font-mono font-medium text-slate-900">{conn.syncedInvoices.toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">Last Sync: {conn.lastSync}</span>
              <div className="flex items-center gap-2">
                {conn.platform.includes('QuickBooks') && (
                  <button
                    onClick={handleSyncQbo}
                    disabled={syncingQbo}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-lg border border-indigo-200 inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${syncingQbo ? 'animate-spin' : ''}`} />
                    <span>{syncingQbo ? 'Syncing...' : 'Sync Now'}</span>
                  </button>
                )}
                <button 
                  onClick={() => handleTestExistingConnector(conn.id, conn.platform, conn.isComingSoon)}
                  disabled={testingId === conn.id}
                  className={`font-semibold text-xs hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50 ${
                    conn.isComingSoon ? 'text-slate-400 hover:text-slate-600' : 'text-indigo-600 hover:text-indigo-700'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${testingId === conn.id ? 'animate-spin' : ''}`} />
                  <span>{testingId === conn.id ? 'Testing...' : conn.isComingSoon ? 'Test Adapter (Soon)' : 'Test (Live)'}</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Adapter Architecture Summary */}
      <div className="bg-slate-50/80 rounded-xl border border-slate-200/80 p-5 space-y-2">
        <div className="flex items-center gap-2 font-bold text-slate-800">
          <Server className="w-4 h-4 text-indigo-600" />
          <span>Adapter Pattern Specifications (`ConnectorAdapter` Class Hierarchy)</span>
        </div>
        <p className="text-slate-600 text-xs leading-relaxed">
          The Hub utilizes an Enterprise Adapter Pattern (`ConnectorAdapter`). Every client integration implements standard methods: 
          <code className="bg-white border border-slate-200 rounded px-1.5 py-0.5 mx-1 text-indigo-600 font-mono text-[11px]">authenticate()</code>, 
          <code className="bg-white border border-slate-200 rounded px-1.5 py-0.5 mx-1 text-indigo-600 font-mono text-[11px]">fetchData()</code>, 
          <code className="bg-white border border-slate-200 rounded px-1.5 py-0.5 mx-1 text-indigo-600 font-mono text-[11px]">validate()</code>, 
          <code className="bg-white border border-slate-200 rounded px-1.5 py-0.5 mx-1 text-indigo-600 font-mono text-[11px]">transform()</code>, and 
          <code className="bg-white border border-slate-200 rounded px-1.5 py-0.5 mx-1 text-indigo-600 font-mono text-[11px]">receiveWebhook()</code>.
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

