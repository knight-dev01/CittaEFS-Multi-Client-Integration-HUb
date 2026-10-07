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
      searchPlaceholder="Search customer name, code, or TIN..."
      emptyMessage="No customers seen yet. They appear here once an invoice references them."
      howItWorks={[
        'A new customer appears here as Pending the first time a B2B/B2G invoice references them.',
        "Download the EFS registration file (pre-filled with everything the Hub knows) and upload it through CittaEFS's own portal — there is no registration API today.",
        'Enter the CittaEFS reference code EFS returns, using Confirm Registered below. Any invoices held up waiting on this customer resubmit automatically.',
      ]}
      detailLine={(m) => `${m.sourceErpId} • TIN ${m.tin || '—'} • via ${m.sourceErp}`}
    />
  );
}
