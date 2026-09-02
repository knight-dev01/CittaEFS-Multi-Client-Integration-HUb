import { useHub } from '../../lib/store';
import { getErpForTenant, ERP_REGISTRY } from '../../config/erpRegistry';
import { AlertCircle, Plug, Settings, Layers, Building2 } from 'lucide-react';
import { OverviewTab } from '../OverviewTab';
import { InvoicesTab } from '../InvoicesTab';
import { ImportTab } from '../ImportTab';
import { CustomerSyncTab } from '../CustomerSyncTab';
import { ItemDictionaryTab } from '../ItemDictionaryTab';
import { ValidationErrorsTab } from '../ValidationErrorsTab';
import { StagingTab } from '../StagingTab';
import { ConnectorsTab } from '../ConnectorsTab';
import { CittaGatewayTab } from './CittaGatewayTab';
import { ErpMappingTab } from './ErpMappingTab';
import { AdminTenantsTab } from '../AdminTenantsTab';

interface Props {
  activeTab: string;
  setActiveTab: (t: string) => void;
  onOpenOnboard: () => void;
}

export function ErpWorkspace({ activeTab, setActiveTab, onOpenOnboard }: Props) {
  const { activeTenant } = useHub();
  if (!activeTenant) return <div className="p-8 text-center text-slate-400 text-xs">Loading workspace...</div>;

  const erp = getErpForTenant(activeTenant.platformType);

  if (erp.comingSoon) {
    return (
      <div className="space-y-6 font-sans text-xs">
        <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-lg"><erp.icon className="w-5 h-5 text-indigo-400" /></div>
            <div>
              <h1 className="text-base font-bold tracking-tight">{erp.label} — Dedicated Workspace</h1>
              <p className="text-slate-400 text-xs mt-1">{erp.description}</p>
            </div>
            <span className="ml-auto px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-full text-[11px] font-bold border border-amber-500/30">COMING SOON</span>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-amber-900"><AlertCircle className="w-4 h-4" /> This ERP is not yet active</div>
          <p className="text-amber-800">This tenant is provisioned for {erp.label}. The dedicated connector, field mapping, and resolution UI will appear here when the adapter is enabled. Use the Gateway tab to pre-configure CittaEFS credentials in the meantime.</p>
          <ul className="list-disc list-inside text-amber-800 space-y-1 mt-2">
            {erp.matching.map((m, i) => <li key={i} className="font-mono text-[11px]">{m}</li>)}
          </ul>
        </div>
        {activeTab === 'gateway' && <CittaGatewayTab />}
        {activeTab === 'mapping' && <ErpMappingTab />}
        {activeTab !== 'gateway' && activeTab !== 'mapping' && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
            <Layers className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p>Select <strong>Gateway</strong> or <strong>Mapping</strong> from the sidebar to configure this ERP.</p>
          </div>
        )}
      </div>
    );
  }

  // Active ERPs — render tab-aware content but always keep ERP chrome
  return (
    <div className="space-y-6">
      {/* ERP chrome banner — shows dedicated UI per tenant */}
      <div className={`rounded-xl p-4 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${erp.id === 'qbo' ? 'bg-amber-50 border-amber-200' : 'bg-indigo-50 border-indigo-200'}`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg border ${erp.id === 'qbo' ? 'bg-amber-500 text-white border-amber-600' : 'bg-indigo-600 text-white border-indigo-700'}`}>
            <erp.icon className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 block">{erp.label} Workspace</span>
            <span className="text-sm font-bold text-slate-900">{activeTenant.name} <span className="font-normal text-slate-500">· {activeTenant.platformType}</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-600 font-mono px-2 py-1 bg-white rounded border border-slate-200">{activeTenant.id}</span>
          {erp.matching.length > 0 && <span className="hidden sm:inline text-[11px] text-slate-500">{erp.matching[0]}</span>}
        </div>
      </div>

      {/* Tab router — only render the active ERP's tabs */}
      {activeTab === 'clients' && <OverviewTab onOpenOnboardModal={onOpenOnboard} />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'import' && <ImportTab onNavigate={(t) => setActiveTab(t)} />}
      {activeTab === 'customers' && <CustomerSyncTab />}
      {activeTab === 'items' && <ItemDictionaryTab />}
      {activeTab === 'staging' && <StagingTab />}
      {activeTab === 'validation' && <ValidationErrorsTab />}
      {activeTab === 'connectors' && <ConnectorsTab />}
      {activeTab === 'mapping' && <ErpMappingTab />}
      {activeTab === 'gateway' && <CittaGatewayTab />}
      {activeTab === 'companies' && <AdminTenantsTab />}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-bold text-slate-900 flex items-center gap-2"><Settings className="w-4 h-4" /> Tenant Settings</h3>
            <p className="text-slate-500 text-xs mt-1">VAT, retry policy, and gateway are per-tenant — open the <button onClick={() => setActiveTab('gateway')} className="text-indigo-600 underline">Gateway & Writeback</button> tab for CittaEFS credentials.</p>
          </div>
        </div>
      )}
    </div>
  );
}
