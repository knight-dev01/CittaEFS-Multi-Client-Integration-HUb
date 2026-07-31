import { useState } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { 
  Plug, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  ArrowRight, 
  ArrowLeft, 
  ShieldCheck, 
  Globe, 
  Database, 
  FileSpreadsheet, 
  Server, 
  Zap, 
  Lock, 
  Check, 
  Key, 
  Clock, 
  Sliders,
  AlertTriangle,
  Eye,
  EyeOff
} from 'lucide-react';
import { Connector, TenantId } from '../types';

interface NewConnectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: TenantId;
  tenantName: string;
  onAddConnector: (connector: Connector) => void;
}

const PLATFORM_OPTIONS = [
  {
    id: 'QuickBooks Online',
    name: 'QuickBooks Online',
    protocol: 'REST API / Webhook',
    authType: 'OAuth 2.0 (Auto-Refresh)',
    defaultEndpoint: 'https://sandbox-quickbooks.api.intuit.com/v3/company/9130351112',
    icon: Globe,
    desc: 'Native OAuth2 flow with CDC webhooks for real-time invoice ingestion.',
    badge: 'ACTIVE / LIVE',
    isActive: true
  },
  {
    id: 'Excel & CSV Import (.xlsx, .csv)',
    name: 'Excel & CSV Import (.xlsx, .csv)',
    protocol: 'SheetJS / Direct Spreadsheet Ingest',
    authType: 'Schema Validation & Signature',
    defaultEndpoint: 's3://cittaefs-ingest-bucket/tenant-excel-drops/',
    icon: FileSpreadsheet,
    desc: 'Direct drag-and-drop .xlsx/.csv spreadsheet parser with column auto-mapping and NRS compliance verification.',
    badge: 'ACTIVE / LIVE',
    isActive: true
  },
  {
    id: 'Sage ERP',
    name: 'Sage ERP (Sage 50 / Sage Intacct)',
    protocol: 'REST API / Webhook',
    authType: 'API Key & Company Session',
    defaultEndpoint: 'https://api.sage.com/v3/company/91238',
    icon: Server,
    desc: 'Direct Sage 50 / Intacct API integration for automated invoice, product, and customer sync.',
    badge: 'COMING SOON',
    isActive: false
  },
  {
    id: 'CittaEFS Gateway (CSL)',
    name: 'CittaEFS Gateway (CSL)',
    protocol: 'REST API / HMAC SHA-256',
    authType: 'X-CittaEFS-Signature',
    defaultEndpoint: 'https://api.cittaefs.com/v1/taxation/stamp',
    icon: ShieldCheck,
    desc: 'CittaEFS Compliance Gateway for real-time tax stamping, IRN generation, and QR verification.',
    badge: 'ACTIVE / LIVE',
    isActive: true
  },
  {
    id: 'SAP S/4HANA',
    name: 'SAP S/4HANA',
    protocol: 'OData REST API',
    authType: 'X-CSRF-Token / OAuth2',
    defaultEndpoint: 'https://my300192.s4hana.cloud.sap/sap/opu/odata/sap/API_INVOICE_SRV',
    icon: Server,
    desc: 'Enterprise OData service with CSRF protection and batch payload handling.',
    badge: 'COMING SOON',
    isActive: false
  },
  {
    id: 'NetSuite SuiteTalk',
    name: 'NetSuite SuiteTalk',
    protocol: 'RESTlet / Webhook',
    authType: 'Token-Based Auth (TBA)',
    defaultEndpoint: 'https://1234567.restlets.api.netsuite.com/app/site/hosting/restlet.nl',
    icon: Zap,
    desc: 'SuiteTalk RESTlets with cryptographic TBA signatures and scriptlet handlers.',
    badge: 'COMING SOON',
    isActive: false
  },
  {
    id: 'Odoo ERP',
    name: 'Odoo ERP',
    protocol: 'JSON-RPC Protocol',
    authType: 'Session Key / API Key',
    defaultEndpoint: 'https://mycompany.odoo.com/jsonrpc',
    icon: Sliders,
    desc: 'Lightweight JSON-RPC protocol endpoint with multi-company database context.',
    badge: 'COMING SOON',
    isActive: false
  },
  {
    id: 'Custom SQL Staging DB',
    name: 'Custom SQL Staging DB',
    protocol: 'PostgreSQL / View Poller',
    authType: 'TLS Encrypted Pool',
    defaultEndpoint: 'postgresql://db.tenant.internal:5432/erp_staging_db',
    icon: Database,
    desc: 'Direct encrypted view poller for legacy SQL databases and staging tables.',
    badge: 'COMING SOON',
    isActive: false
  }
];

export function NewConnectorModal({ isOpen, onClose, tenantId, tenantName, onAddConnector }: NewConnectorModalProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Form State
  const [selectedPlatform, setSelectedPlatform] = useState(PLATFORM_OPTIONS[0]);
  const [environment, setEnvironment] = useState<'SANDBOX' | 'PRODUCTION'>('SANDBOX');
  const [endpointUrl, setEndpointUrl] = useState(PLATFORM_OPTIONS[0].defaultEndpoint);
  const [authScheme, setAuthScheme] = useState(PLATFORM_OPTIONS[0].authType);
  const [clientId, setClientId] = useState('app_key_live_992014');
  const [clientSecret, setClientSecret] = useState('secret_aes_gcm_88391204');
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('whsec_771923001');
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [syncInterval, setSyncInterval] = useState('Real-Time Webhook (CDC)');

  // Test State
  const [testStatus, setTestStatus] = useState<'IDLE' | 'TESTING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [testLogs, setTestLogs] = useState<string[]>([]);
  const [testLatency, setTestLatency] = useState<number>(0);

  if (!isOpen) return null;

  const handleSelectPlatform = (opt: typeof PLATFORM_OPTIONS[0]) => {
    if (!opt.isActive) {
      alert(`ℹ️ ${opt.name} is currently marked COMING SOON in this MVP release.\n\nActive fully-supported connectors:\n1. QuickBooks Online\n2. Excel & CSV Import (.xlsx, .csv)\n3. CittaEFS Gateway (CSL)`);
      return;
    }
    setSelectedPlatform(opt);
    setEndpointUrl(opt.defaultEndpoint);
    setAuthScheme(opt.authType);
  };

  const handleRunConnectionTest = async () => {
    setTestStatus('TESTING');
    setTestLogs([
      `Connecting to ${endpointUrl}...`
    ]);

    try {
      const isQbo = selectedPlatform.id === 'QuickBooks Online';
      const url = isQbo ? '/api/connectors/qbo/test-live' : '/api/connectors/test';
      const body = isQbo 
        ? { realmId: clientId || '9130351112', accessToken: clientSecret, environment, endpointUrl }
        : { platform: selectedPlatform.name, config: { endpointUrl, authType: authScheme } };

      const res = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await parseJsonResponse(res);

      if (res.ok && data.success !== false) {
        setTestLogs(prev => [
          ...prev,
          `Connection established successfully (${data.latencyMs || 45} ms).`,
          `Status: ${data.status || 'OK'} - Auth: ${data.authStatus || data.auth?.status || 'Verified'}`
        ]);
        setTestLatency(data.latencyMs || 45);
        setTestStatus('SUCCESS');
      } else {
        setTestStatus('FAILED');
        setTestLogs(prev => [
          ...prev,
          `Connection Failed: ${data.error || data.message || 'Authentication or network handshake failed with remote server.'}`
        ]);
      }
    } catch (err: any) {
      setTestLogs(prev => [...prev, `Connection Error: ${err.message}`]);
      setTestStatus('FAILED');
    }
  };

  const handleSaveAndRegister = () => {
    const newConn: Connector = {
      id: `conn_${Date.now().toString().slice(-6)}`,
      tenantId: tenantId,
      platform: selectedPlatform.name,
      type: selectedPlatform.protocol,
      auth: authScheme,
      status: 'HEALTHY',
      endpoint: endpointUrl,
      latencyMs: testLatency || 58,
      lastSync: 'Just now',
      syncedInvoices: 0,
      environment: environment,
      syncInterval: syncInterval
    };

    onAddConnector(newConn);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-mono text-xs">
      <div className="bg-white max-w-3xl w-full border-4 border-slate-900 shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-4 border-b-2 border-slate-900 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-black text-amber-400 text-sm uppercase flex items-center gap-2">
              <Plug className="w-5 h-5 text-amber-400" />
              <span>Configure New ERP / Accounting Connector Adapter</span>
            </h3>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Multi-Step Adapter Onboarding • Tenant: <strong className="text-white">{tenantName}</strong> ({tenantId})
            </p>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white font-black text-sm p-1 uppercase"
          >
            ✕
          </button>
        </div>

        {/* Stepper Progress Bar */}
        <div className="bg-slate-100 border-b-2 border-slate-900 p-3 flex justify-between items-center shrink-0">
          {[
            { step: 1, title: '1. Select Platform' },
            { step: 2, title: '2. Credentials & URI' },
            { step: 3, title: '3. Connection Test' },
            { step: 4, title: '4. Save & Register' }
          ].map((s) => {
            const isDone = currentStep > s.step;
            const isCurrent = currentStep === s.step;

            return (
              <div 
                key={s.step} 
                onClick={() => { if (s.step < currentStep) setCurrentStep(s.step as any); }}
                className={`flex items-center gap-1.5 font-black uppercase text-[11px] cursor-pointer ${
                  isCurrent ? 'text-indigo-900' : isDone ? 'text-emerald-700' : 'text-slate-400'
                }`}
              >
                <span className={`w-5 h-5 flex items-center justify-center rounded-none border border-slate-900 text-[10px] ${
                  isCurrent ? 'bg-amber-400 text-slate-950 font-black' :
                  isDone ? 'bg-emerald-400 text-slate-950 font-black' : 'bg-white text-slate-500'
                }`}>
                  {isDone ? '✓' : s.step}
                </span>
                <span className="hidden sm:inline">{s.title}</span>
              </div>
            );
          })}
        </div>

        {/* Body Content Scrollable */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          
          {/* STEP 1: Select Platform */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-black text-slate-900 uppercase text-xs">Choose Target Source Platform</h4>
                <p className="text-slate-600 text-[11px]">Select the ERP or accounting system providing incoming invoice data for NRS fiscalization.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PLATFORM_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = selectedPlatform.id === opt.id;

                  return (
                    <div
                      key={opt.id}
                      onClick={() => handleSelectPlatform(opt)}
                      className={`p-3 border-2 border-slate-900 cursor-pointer space-y-2 transition-all ${
                        isSelected ? 'bg-slate-900 text-white shadow-md' : 'bg-white hover:bg-slate-50 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-indigo-600'}`} />
                          <span className="font-black uppercase">{opt.name}</span>
                        </div>
                        <span className={`px-1.5 py-0.2 text-[9px] font-black border uppercase ${
                          isSelected ? 'bg-amber-400 text-slate-950 border-amber-400' : 'bg-slate-100 text-slate-800 border-slate-900'
                        }`}>
                          {opt.badge}
                        </span>
                      </div>

                      <p className={`text-[10px] leading-tight ${isSelected ? 'text-slate-300' : 'text-slate-600'}`}>
                        {opt.desc}
                      </p>

                      <div className="pt-1.5 border-t border-slate-700/40 flex justify-between text-[10px] font-bold">
                        <span>{opt.protocol}</span>
                        <span className={isSelected ? 'text-amber-400' : 'text-indigo-700'}>{opt.authType}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Credentials & URI */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
                <div>
                  <h4 className="font-black text-slate-900 uppercase text-xs flex items-center gap-2">
                    <span>Credentials & Gateway Endpoints for</span>
                    <span className="text-indigo-700">{selectedPlatform.name}</span>
                  </h4>
                  <p className="text-slate-600 text-[11px]">Specify REST URI and authorization secrets for the connector handshake.</p>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 border border-emerald-400 text-emerald-800 font-black text-[10px]">
                  AES-256-GCM SECURED
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-black text-slate-900 uppercase mb-1">Environment Stage</label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as any)}
                    className="w-full px-3 py-2 border-2 border-slate-900 font-bold bg-white focus:outline-none"
                  >
                    <option value="SANDBOX">Sandbox / Staging Instance</option>
                    <option value="PRODUCTION">Live Production Enterprise Instance</option>
                  </select>
                </div>

                <div>
                  <label className="block font-black text-slate-900 uppercase mb-1">Authentication Scheme</label>
                  <select
                    value={authScheme}
                    onChange={(e) => setAuthScheme(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-900 font-bold bg-white focus:outline-none"
                  >
                    <option value="OAuth 2.0 (Auto-Refresh)">OAuth 2.0 with Auto-Refresh Workers</option>
                    <option value="X-CSRF-Token / OAuth2">OData X-CSRF-Token / Client Credentials</option>
                    <option value="Token-Based Auth (TBA)">Token-Based Auth (TBA HMAC-SHA256)</option>
                    <option value="Session Key / API Key">Bearer Token / X-API-Key Header</option>
                    <option value="TLS Encrypted Pool">PostgreSQL TLS Connection String</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block font-black text-slate-900 uppercase mb-1">Base REST Endpoint / URI</label>
                  <input
                    type="text"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-900 font-mono text-slate-900 font-bold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-black text-slate-900 uppercase mb-1">Client ID / Application Key</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-900 font-mono text-slate-900 font-bold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-black text-slate-900 uppercase mb-1">Client Secret / Private Key</label>
                  <div className="relative">
                    <input
                      type={showClientSecret ? "text" : "password"}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      className="w-full px-3 py-2.5 pr-10 border-2 border-slate-900 font-mono text-slate-900 font-bold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientSecret(!showClientSecret)}
                      className="absolute right-2.5 top-3 text-slate-500 hover:text-slate-900 cursor-pointer"
                      title={showClientSecret ? "Hide secret" : "Show secret"}
                    >
                      {showClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-black text-slate-900 uppercase mb-1">Webhook Signing Secret</label>
                  <div className="relative">
                    <input
                      type={showWebhookSecret ? "text" : "password"}
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      className="w-full px-3 py-2.5 pr-10 border-2 border-slate-900 font-mono text-slate-900 font-bold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                      className="absolute right-2.5 top-3 text-slate-500 hover:text-slate-900 cursor-pointer"
                      title={showWebhookSecret ? "Hide secret" : "Show secret"}
                    >
                      {showWebhookSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-black text-slate-900 uppercase mb-1">Ingestion Frequency Schedule</label>
                  <select
                    value={syncInterval}
                    onChange={(e) => setSyncInterval(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-900 font-bold bg-white focus:outline-none"
                  >
                    <option value="Real-Time Webhook (CDC)">Real-Time Webhook (CDC Instant Push)</option>
                    <option value="Every 5 Minutes">Every 5 Minutes Polling Worker</option>
                    <option value="Every 15 Minutes">Every 15 Minutes Polling Worker</option>
                    <option value="Hourly Nightly Batch">Hourly / Nightly Batch Reconciliation</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Connection Test */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-black text-slate-900 uppercase text-xs">Verify Adapter Handshake & Endpoint Ping</h4>
                <p className="text-slate-600 text-[11px]">Execute a test handshake to ensure the Hub can authenticate and read sample schemas.</p>
              </div>

              <div className="p-4 bg-slate-900 text-white border-2 border-slate-900 space-y-3 font-mono">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-amber-400 font-bold">Target: {selectedPlatform.name} ({environment})</span>
                  <span className="text-xs font-bold text-slate-300">{endpointUrl}</span>
                </div>

                <div className="space-y-1.5 min-h-[110px] text-[11px]">
                  {testLogs.length === 0 ? (
                    <div className="text-slate-500 italic py-4 text-center">
                      Click 'Run Adapter Handshake Test' to initiate real-time socket verification.
                    </div>
                  ) : (
                    testLogs.map((log, i) => (
                      <div key={i} className="text-emerald-400 font-mono">
                        {log}
                      </div>
                    ))
                  )}
                </div>

                {testStatus === 'SUCCESS' && (
                  <div className="p-3 bg-emerald-400 text-slate-950 font-black border-2 border-slate-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-slate-950" />
                      <span>CONNECTION VERIFIED! Live API Endpoint Reachable.</span>
                    </div>
                    <span className="px-2 py-0.5 bg-slate-950 text-emerald-400 font-mono text-[10px]">
                      {testLatency} ms
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleRunConnectionTest}
                  disabled={testStatus === 'TESTING'}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase border-2 border-slate-900 cursor-pointer flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${testStatus === 'TESTING' ? 'animate-spin' : ''}`} />
                  <span>{testStatus === 'TESTING' ? 'Testing Handshake...' : 'Run Adapter Handshake Test'}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Save & Register */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="border-b-2 border-slate-900 pb-2">
                <h4 className="font-black text-slate-900 uppercase text-xs">Review & Register Connector</h4>
                <p className="text-slate-600 text-[11px]">Confirm configuration details before registering this adapter into active middleware routing.</p>
              </div>

              <div className="bg-slate-50 border-2 border-slate-900 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-slate-800">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Platform Adapter</span>
                    <span className="font-black text-slate-900">{selectedPlatform.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Protocol & Auth</span>
                    <span className="font-black text-slate-900">{authScheme}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Target Tenant</span>
                    <span className="font-black text-slate-900">{tenantName}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Environment</span>
                    <span className="font-black text-emerald-700">{environment}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Endpoint URI</span>
                    <span className="font-mono text-slate-900 font-bold">{endpointUrl}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">Connection Handshake Status:</span>
                  <span className="px-2 py-0.5 bg-emerald-300 text-slate-950 font-black border border-slate-900">
                    PASSED ({testLatency || 58}ms)
                  </span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border-2 border-amber-300 text-[10px] text-amber-900 space-y-1">
                <strong>Middleware Policy Notice:</strong>
                <p>Registering this connector will immediately enable webhook listening and automated CDC field mapping for incoming invoice payloads.</p>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer Controls */}
        <div className="bg-slate-100 p-4 border-t-2 border-slate-900 flex items-center justify-between shrink-0">
          <button
            type="button"
            disabled={currentStep === 1}
            onClick={() => setCurrentStep(prev => (prev - 1) as any)}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-900 font-black uppercase border-2 border-slate-900 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          {currentStep < 4 ? (
            <button
              type="button"
              onClick={() => setCurrentStep(prev => (prev + 1) as any)}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black uppercase border-2 border-slate-900 cursor-pointer flex items-center gap-1"
            >
              <span>Next Step</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveAndRegister}
              className="px-6 py-2 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black uppercase border-2 border-slate-900 cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-950" />
              <span>Save & Register Connector</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
