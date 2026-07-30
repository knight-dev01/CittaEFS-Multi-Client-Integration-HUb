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
      id: 'conn_sage_03',
      tenantId: activeTenant.id,
      platform: 'Sage ERP (Sage 50 / Sage Intacct)',
      type: 'REST API / Webhook',
      auth: 'API Key & Session Token',
      status: 'HEALTHY',
      endpoint: 'https://api.sage.com/v3/company/91238',
      latencyMs: 88,
      lastSync: '5 mins ago',
      syncedInvoices: 3410,
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
    },
    {
      id: 'conn_sap_04',
      tenantId: activeTenant.id,
      platform: 'SAP S/4HANA',
      type: 'OData REST API',
      auth: 'X-CSRF-Token / OAuth2',
      status: 'WARNING',
      endpoint: 'https://my300192.s4hana.cloud.sap/sap/opu/odata/sap/API_INVOICE_SRV',
      latencyMs: 0,
      lastSync: 'Not Configured',
      syncedInvoices: 0,
      environment: 'PRODUCTION',
      isComingSoon: true
    },
    {
      id: 'conn_ns_05',
      tenantId: activeTenant.id,
      platform: 'NetSuite SuiteTalk',
      type: 'RESTlet / Webhook',
      auth: 'Token-Based Auth (TBA)',
      status: 'WARNING',
      endpoint: 'https://1234567.restlets.api.netsuite.com/app/site/hosting/restlet.nl',
      latencyMs: 0,
      lastSync: 'Not Configured',
      syncedInvoices: 0,
      environment: 'PRODUCTION',
      isComingSoon: true
    },
    {
      id: 'conn_sql_06',
      tenantId: activeTenant.id,
      platform: 'Custom SQL Staging DB',
      type: 'PostgreSQL / View Poller',
      auth: 'TLS Encrypted Pool',
      status: 'WARNING',
      endpoint: 'postgresql://db.tenant.internal:5432/erp_staging',
      latencyMs: 0,
      lastSync: 'Not Configured',
      syncedInvoices: 0,
      environment: 'SANDBOX',
      isComingSoon: true
    }
  ]);

  const handleAddConnector = (newConn: Connector) => {
    setConnectors([newConn, ...connectors]);
    alert(`Connector for ${newConn.platform} successfully registered and activated!`);
  };

  const handleTestExistingConnector = async (id: string, platformName: string, isComingSoon?: boolean) => {
    if (isComingSoon) {
      alert(`ℹ️ ${platformName} Adapter is COMING SOON in the upcoming release!\n\nNote: QuickBooks Online, Sage ERP, and Excel & CSV Import are currently ACTIVE and ready for live API testing and transmission to CittaEFS.`);
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
    <div className="space-y-6 font-mono text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-4 border-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-amber-400 uppercase flex items-center gap-2">
            <Plug className="w-5 h-5 text-amber-400" />
            Pluggable ERP & Accounting Connectors Hub
          </h2>
          <p className="text-slate-300 text-xs mt-1">
            Active Adapter Architecture • Tenant: <strong className="text-white">{activeTenant.name}</strong> ({activeTenant.id})
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black uppercase border-2 border-slate-900 cursor-pointer inline-flex items-center space-x-1.5 shrink-0"
        >
          <Plus className="w-4 h-4 text-slate-950" />
          <span>+ Add New Connector Adapter</span>
        </button>
      </div>

      {/* Connector Health Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {connectors.map((conn) => (
          <div key={conn.id} className="bg-white border-2 border-slate-900 p-4 space-y-3 relative hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between pb-2 border-b-2 border-slate-100">
              <div className="flex items-center gap-2">
                {conn.platform.includes('SQL') ? (
                  <Database className="w-4 h-4 text-indigo-600" />
                ) : conn.platform.includes('CSV') ? (
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                ) : conn.platform.includes('SAP') ? (
                  <Server className="w-4 h-4 text-indigo-600" />
                ) : conn.platform.includes('NetSuite') ? (
                  <Zap className="w-4 h-4 text-amber-600" />
                ) : (
                  <Globe className="w-4 h-4 text-amber-600" />
                )}
                <span className="font-black text-slate-900 text-sm uppercase">{conn.platform}</span>
              </div>
              {conn.isComingSoon ? (
                <span className="px-2 py-0.5 text-[10px] font-black uppercase border border-slate-900 bg-slate-200 text-slate-800">
                  COMING SOON
                </span>
              ) : (
                <span className={`px-2 py-0.5 text-[10px] font-black uppercase border border-slate-900 ${
                  conn.status === 'HEALTHY' ? 'bg-emerald-300 text-slate-950' : 'bg-amber-300 text-slate-950'
                }`}>
                  {conn.status} (LIVE)
                </span>
              )}
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between text-slate-600">
                <span>Protocol:</span>
                <span className="font-bold text-slate-900">{conn.type}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Auth Scheme:</span>
                <span className="font-bold text-slate-900">{conn.auth}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Adapter Latency:</span>
                <span className="font-mono font-bold text-emerald-700">{conn.isComingSoon ? 'N/A' : `${conn.latencyMs} ms`}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Total Ingested:</span>
                <span className="font-mono font-bold text-slate-900">{conn.syncedInvoices.toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-2 border-t-2 border-slate-100 flex items-center justify-between text-[10px]">
              <span className="text-slate-500 font-bold">Last Sync: {conn.lastSync}</span>
              <button 
                onClick={() => handleTestExistingConnector(conn.id, conn.platform, conn.isComingSoon)}
                disabled={testingId === conn.id}
                className={`font-black hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50 ${
                  conn.isComingSoon ? 'text-slate-500 hover:text-slate-800' : 'text-indigo-700'
                }`}
              >
                <RefreshCw className={`w-3 h-3 ${testingId === conn.id ? 'animate-spin' : ''}`} />
                <span>{testingId === conn.id ? 'Testing...' : conn.isComingSoon ? 'Test Adapter (Soon)' : 'Test Adapter (Live)'}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Adapter Architecture Summary */}
      <div className="bg-slate-100 border-2 border-slate-900 p-4 space-y-3">
        <div className="flex items-center gap-2 font-black text-slate-900 uppercase">
          <Server className="w-4 h-4 text-slate-900" />
          <span>Adapter Pattern Specifications (`ConnectorAdapter` Class Hierarchy)</span>
        </div>
        <p className="text-slate-700 text-xs leading-relaxed">
          The Hub utilizes an Enterprise Adapter Pattern (`ConnectorAdapter`). Every client integration implements standard methods: 
          <code className="bg-white border border-slate-400 px-1 py-0.5 ml-1 text-slate-900 font-bold">authenticate()</code>, 
          <code className="bg-white border border-slate-400 px-1 py-0.5 ml-1 text-slate-900 font-bold">fetchData()</code>, 
          <code className="bg-white border border-slate-400 px-1 py-0.5 ml-1 text-slate-900 font-bold">validate()</code>, 
          <code className="bg-white border border-slate-400 px-1 py-0.5 ml-1 text-slate-900 font-bold">transform()</code>, and 
          <code className="bg-white border border-slate-400 px-1 py-0.5 ml-1 text-slate-900 font-bold">receiveWebhook()</code>.
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

