import { useHub } from '../../lib/store';
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

  return (
    <div className="space-y-6">
      {/* Tab router — only render the active ERP's tabs */}
      {activeTab === 'clients' && <OverviewTab />}
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
