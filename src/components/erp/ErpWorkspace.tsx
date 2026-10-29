import { useHub } from '../../lib/store';
import { ConnectionsTab } from '../ConnectionsTab';
import { InvoicesTab } from '../InvoicesTab';

interface Props {
  activeTab: string;
  // Optionally pass an existing tenant to resume its step-2 connect flow
  // (e.g. a tenant whose channel was never authenticated) instead of
  // starting fresh onboarding.
  onOpenOnboard: (resumeTenant?: any) => void;
}

export function ErpWorkspace({ activeTab, onOpenOnboard }: Props) {
  const { activeTenant } = useHub();
  if (!activeTenant) return <div className="p-8 text-center text-slate-400 text-xs">Loading workspace...</div>;

  return (
    <div className="space-y-6">
      {/* Gateway UI: connection status + normalised invoice ledger only */}
      {activeTab === 'connections' && <ConnectionsTab onResumeConnect={() => onOpenOnboard(activeTenant)} />}
      {activeTab === 'invoices' && <InvoicesTab />}
    </div>
  );
}
