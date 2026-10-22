import { Users } from 'lucide-react';
import { EntityRegistrationQueue } from './EntityRegistrationQueue';

// Thin-hub pivot (docs/CittaHub_Revision_Plan.md Phase 4): CittaEFS owns
// customer registration — there is no API to create one, only its own Excel
// bulk-upload templates. This tab is a queue to clear, not a directory the
// Hub owns: it shows customers the Hub has seen from a client ERP and their
// CittaEFS registration status, with a fast path from "unregistered" to
// "registered and invoices resubmitted."
export function CustomerSyncTab() {
  return (
    <EntityRegistrationQueue
      entityType="CUSTOMER"
      icon={Users}
      title="Customer Registrations"
      subtitle="CittaEFS owns customer records. This is a queue to clear, not a directory to edit."
      searchHint="Search customer name, code, or TIN..."
      emptyMessage="No customers seen yet. They appear here once an invoice references them."
      detailLine={(m) => `${m.sourceErpId} • TIN ${m.tin || '—'} • via ${m.sourceErp}`}
    />
  );
}
