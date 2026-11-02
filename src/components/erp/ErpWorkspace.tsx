import { useHub } from '../../lib/store';
import { ConnectionsTab } from '../ConnectionsTab';
import { InvoicesTab } from '../InvoicesTab';
import { ValidationTab } from '../ValidationTab';

interface Props {
  activeTab: string;
  // Optionally pass an existing tenant to resume its step-2 connect flow
  // (e.g. a tenant whose channel was never authenticated) instead of
  // starting fresh onboarding.
  onOpenOnboard: (resumeTenant?: any) => void;
}

export function ErpWorkspace({ activeTab, onOpenOnboard }: Props) {
  const { activeTenant } = useHub();
  if (!activeTenant) return <p className="py-16 text-center text-sm text-ink-soft">Loading workspace…</p>;

  return (
    <div className="space-y-6">
      {/* Gateway UI: connection status + normalised invoice ledger only */}
      {activeTab === 'connections' && <ConnectionsTab onResumeConnect={() => onOpenOnboard(activeTenant)} />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'validation' && <ValidationTab />}
    </div>
  );
}
