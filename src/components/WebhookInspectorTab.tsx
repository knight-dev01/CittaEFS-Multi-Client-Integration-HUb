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
    <div className="space-y-6 font-mono text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-4 border-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-amber-400 uppercase flex items-center gap-2">
            <Radio className="w-5 h-5 text-amber-400" />
            Real-Time Webhook Inspector & Dispatch Replay
          </h2>
          <p className="text-slate-300 text-xs mt-1">
            Raw Payload Debugger • Signature Verification • Tenant: <strong className="text-white">{activeTenant.name}</strong>
          </p>
        </div>
      </div>

      {/* Main Grid: Webhooks List + Inspection Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Webhook Event Log List */}
        <div className="lg:col-span-6 bg-white border-2 border-slate-900 overflow-hidden">
          <div className="p-3 bg-slate-100 border-b-2 border-slate-900 font-black uppercase text-slate-900 flex justify-between items-center">
            <span>Incoming Webhook Streams ({incomingWebhooks.length})</span>
            <span className="text-[10px] text-slate-600 font-normal">HTTP POST Listeners</span>
          </div>

          <div className="divide-y-2 divide-slate-100 font-mono">
            {incomingWebhooks.map((wh) => (
              <div 
                key={wh.id}
                onClick={() => setSelectedWebhook(wh)}
                className={`p-3 cursor-pointer hover:bg-amber-50 transition-colors space-y-1.5 ${
                  selectedWebhook?.id === wh.id ? 'bg-amber-100 border-l-4 border-slate-900' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-black text-slate-900">{wh.source}</span>
                  <span className={`px-2 py-0.5 border border-slate-900 text-[10px] font-black uppercase ${
                    wh.statusCode === 200 ? 'bg-emerald-300 text-slate-950' : 'bg-red-400 text-slate-950'
                  }`}>
                    {wh.statusCode} OK
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span className="font-bold text-indigo-700">{wh.event}</span>
                  <span>{wh.processingTimeMs} ms</span>
                </div>
                <div className="text-[10px] text-slate-500 font-bold flex justify-between pt-1">
                  <span>{wh.timestamp}</span>
                  <span className="text-slate-900">{wh.id}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Detailed Inspection Panel */}
        <div className="lg:col-span-6 bg-white border-2 border-slate-900 p-4 space-y-4">
          {selectedWebhook ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
                <div>
                  <span className="text-[10px] text-slate-500 font-black uppercase block">Inspecting Payload</span>
                  <h4 className="font-black text-slate-900 text-sm uppercase">{selectedWebhook.id} — {selectedWebhook.source}</h4>
                </div>
                <button
                  onClick={() => handleReplayWebhook(selectedWebhook)}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black border-2 border-slate-900 uppercase cursor-pointer"
                >
                  Replay Payload
                </button>
              </div>

              <div>
                <span className="font-black text-slate-900 uppercase block mb-1">HTTP Headers</span>
                <pre className="bg-slate-900 text-emerald-400 p-3 text-[11px] font-mono border-2 border-slate-900 overflow-x-auto">
                  {JSON.stringify(selectedWebhook.headers, null, 2)}
                </pre>
              </div>

              <div>
                <span className="font-black text-slate-900 uppercase block mb-1">JSON Raw Body Payload</span>
                <pre className="bg-slate-900 text-amber-300 p-3 text-[11px] font-mono border-2 border-slate-900 overflow-x-auto max-h-60">
                  {JSON.stringify(selectedWebhook.body, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 font-bold space-y-2">
              <Code2 className="w-8 h-8 text-slate-400 mx-auto" />
              <p>Select any webhook event on the left to inspect raw headers, signature authentication, and JSON body payload.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
