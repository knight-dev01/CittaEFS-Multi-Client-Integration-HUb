import { useState } from 'react';
import { useHub } from '../lib/store';
import { 
  Radio, 
  RotateCw, 
  CheckCircle2, 
  Eye, 
  Code2, 
  Search, 
  Filter, 
  Activity,
  ArrowDownLeft,
  ArrowUpRight
} from 'lucide-react';

export function WebhookInspectorTab() {
  const { activeTenant } = useHub();

  const [selectedWebhook, setSelectedWebhook] = useState<any | null>(null);

  const incomingWebhooks = [
    {
      id: 'wh_evt_8011',
      tenantId: activeTenant.id,
      source: 'QuickBooks Online',
      event: 'invoice.create',
      endpoint: '/api/v1/webhooks/qbo',
      ipAddress: '54.240.196.12',
      statusCode: 200,
      processingTimeMs: 14,
      timestamp: '2026-07-28 10:18:04',
      headers: {
        'host': 'hub.cittaefs.com',
        'content-type': 'application/json',
        'intuit-signature': 'QBO-SHA256-v891a21bc901...',
        'user-agent': 'Intuit-Hookshot/2.0'
      },
      body: {
        eventNotifications: [{
          realmId: '9130351112',
          dataChangeEvent: {
            entities: [{ name: 'Invoice', id: '1088', operation: 'Create', lastUpdated: '2026-07-28T10:18:00Z' }]
          }
        }]
      }
    },
    {
      id: 'wh_evt_8012',
      tenantId: activeTenant.id,
      source: 'CittaEFS Gateway C# REST',
      event: 'invoice.signed.callback',
      endpoint: '/api/v1/webhooks/cittaefs-callback',
      ipAddress: '34.117.88.22',
      statusCode: 200,
      processingTimeMs: 8,
      timestamp: '2026-07-28 10:15:30',
      headers: {
        'host': 'hub.cittaefs.com',
        'content-type': 'application/json',
        'x-citta-signature': 'CITTA-HMAC-SHA256-ff9102...',
        'user-agent': 'CittaEFS-DotNetGateway/1.4'
      },
      body: {
        TenantId: activeTenant.id,
        ClientInvoiceNumber: 'INV-2026-001',
        Irn: 'IRN-NRS-2026-889123',
        Csid: 'CSID-SHA256-88190123',
        QrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-NRS-2026-889123',
        NrsStampTimestamp: '2026-07-28T10:15:29Z'
      }
    },
    {
      id: 'wh_evt_8013',
      tenantId: activeTenant.id,
      source: 'SAP S/4HANA',
      event: 'BillingDocument.Created',
      endpoint: '/api/v1/webhooks/sap',
      ipAddress: '198.51.100.44',
      statusCode: 500,
      processingTimeMs: 42,
      timestamp: '2026-07-28 09:50:11',
      headers: {
        'host': 'hub.cittaefs.com',
        'content-type': 'application/json',
        'x-sap-event-id': 'evt_sap_771203',
        'user-agent': 'SAP-EventMesh/1.0'
      },
      body: {
        event: 'BillingDocument.Created',
        data: { BillingDocument: '90001882', CompanyCode: '1010' },
        error: 'Unmapped Item SKU MAT-SAP-X9'
      }
    }
  ];

  const handleReplayWebhook = (wh: any) => {
    alert(`Replaying webhook ${wh.id} (${wh.event}) to endpoint ${wh.endpoint}. Pre-flight Zod validation triggered!`);
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-indigo-400" />
            Real-Time Webhook Inspector & Dispatch Replay
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Raw Payload Debugger • Signature Verification • Workspace: <strong className="text-white font-medium">{activeTenant.name}</strong>
          </p>
        </div>
      </div>

      {/* Main Grid: Webhooks List + Inspection Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Webhook Event Log List */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
          <div className="p-4 bg-slate-50 border-b border-slate-100 font-bold text-slate-900 flex justify-between items-center">
            <span>Incoming Webhook Streams ({incomingWebhooks.length})</span>
            <span className="text-xs text-slate-500 font-normal">HTTP POST Listeners</span>
          </div>

          <div className="divide-y divide-slate-100">
            {incomingWebhooks.map((wh) => (
              <div 
                key={wh.id}
                onClick={() => setSelectedWebhook(wh)}
                className={`p-4 cursor-pointer hover:bg-slate-50/80 transition-all space-y-2 ${
                  selectedWebhook?.id === wh.id ? 'bg-indigo-50/60 border-l-4 border-indigo-600' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{wh.source}</span>
                  <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-semibold ${
                    wh.statusCode === 200 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {wh.statusCode} OK
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono font-medium text-indigo-600">{wh.event}</span>
                  <span className="font-mono text-[11px]">{wh.processingTimeMs} ms</span>
                </div>
                <div className="text-[11px] text-slate-400 font-medium flex justify-between pt-0.5">
                  <span>{wh.timestamp}</span>
                  <span className="font-mono text-slate-500">{wh.id}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Detailed Inspection Panel */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
          {selectedWebhook ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider block">Inspecting Payload</span>
                  <h4 className="font-bold text-slate-900 text-sm">{selectedWebhook.id} — {selectedWebhook.source}</h4>
                </div>
                <button
                  onClick={() => handleReplayWebhook(selectedWebhook)}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer transition-colors"
                >
                  Replay Payload
                </button>
              </div>

              <div>
                <span className="font-semibold text-slate-800 block mb-1.5">HTTP Headers</span>
                <pre className="bg-slate-900 text-emerald-400 p-4 text-[11px] font-mono rounded-lg overflow-x-auto shadow-inner">
                  {JSON.stringify(selectedWebhook.headers, null, 2)}
                </pre>
              </div>

              <div>
                <span className="font-semibold text-slate-800 block mb-1.5">JSON Raw Body Payload</span>
                <pre className="bg-slate-900 text-amber-300 p-4 text-[11px] font-mono rounded-lg overflow-x-auto max-h-60 shadow-inner">
                  {JSON.stringify(selectedWebhook.body, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="py-12 px-6 text-center text-slate-400 font-medium space-y-2">
              <Code2 className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs">Select any webhook event on the left to inspect raw headers, signature authentication, and JSON body payload.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
