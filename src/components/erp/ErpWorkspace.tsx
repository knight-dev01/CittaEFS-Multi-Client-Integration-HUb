import { useHub } from '../../lib/store';
import { OverviewTab } from '../OverviewTab';
import { ConnectionsTab } from '../ConnectionsTab';
import { InvoicesTab } from '../InvoicesTab';
import { ValidationTab } from '../ValidationTab';
import { DirectoriesTab } from '../DirectoriesTab';
import { SettingsTab } from '../SettingsTab';
import { AuditLogTab } from '../AuditLogTab';

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
      {/* Gateway UI: overview, connections, normalised ledger, validation queue,
          read-only ERP directories, shared gateway settings and the audit trail. */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'connections' && <ConnectionsTab onResumeConnect={() => onOpenOnboard(activeTenant)} />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'validation' && <ValidationTab />}
      {activeTab === 'directories' && <DirectoriesTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'audit' && <AuditLogTab />}
    </div>
  );
}
