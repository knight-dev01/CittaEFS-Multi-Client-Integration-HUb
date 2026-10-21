import { useHub } from '../../lib/store';
import { getErpForTenant } from '../../config/erpRegistry';
import { OverviewTab } from '../OverviewTab';
import { InvoicesTab } from '../InvoicesTab';
import { ImportTab } from '../ImportTab';
import { CustomerSyncTab } from '../CustomerSyncTab';
import { ItemDictionaryTab } from '../ItemDictionaryTab';
import { ValidationErrorsTab } from '../ValidationErrorsTab';
import { ConnectorsTab } from '../ConnectorsTab';
import { CittaGatewayTab } from './CittaGatewayTab';
import { ErpMappingTab } from './ErpMappingTab';
import { AdminTenantsTab } from '../AdminTenantsTab';

interface Props {
  activeTab: string;
  setActiveTab: (t: string) => void;
  // Optionally pass an existing tenant to resume its step-2 connect flow
  // (e.g. a tenant whose channel was never authenticated) instead of
  // starting fresh onboarding.
  onOpenOnboard: (resumeTenant?: any) => void;
}

export function ErpWorkspace({ activeTab, setActiveTab, onOpenOnboard }: Props) {
  const { activeTenant } = useHub();
  if (!activeTenant) return <div className="p-8 text-center text-slate-400 text-xs">Loading workspace...</div>;

  const erp = getErpForTenant(activeTenant.platformType);

  return (
    <div className="space-y-6">
      {/* ERP chrome banner — shows dedicated UI per tenant */}
      <div className={`rounded-lg p-4 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${erp.id === 'qbo' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-300'}`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg border ${erp.id === 'qbo' ? 'bg-amber-500 text-white border-amber-600' : 'bg-emerald-700 text-white border-emerald-800'}`}>
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
      {activeTab === 'invoices' && <InvoicesTab onNavigate={setActiveTab} />}
      {activeTab === 'import' && <ImportTab onNavigate={(t) => setActiveTab(t)} />}
      {activeTab === 'customers' && <CustomerSyncTab />}
      {activeTab === 'items' && <ItemDictionaryTab />}
      {activeTab === 'validation' && <ValidationErrorsTab onNavigate={setActiveTab} />}
      {activeTab === 'connectors' && <ConnectorsTab onResumeConnect={() => onOpenOnboard(activeTenant)} />}
      {activeTab === 'mapping' && <ErpMappingTab />}
      {activeTab === 'gateway' && <CittaGatewayTab />}
      {activeTab === 'companies' && <AdminTenantsTab />}
    </div>
  );
}
