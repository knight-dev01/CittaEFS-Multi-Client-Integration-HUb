import { Zap, FileSpreadsheet, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ErpId = 'qbo' | 'excel' | 'odoo' | 'generic';

export interface ErpDefinition {
  id: ErpId;
  platformType: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  color: string;
  description: string;
  comingSoon?: boolean;
  // Which hub tabs this ERP shows (subset of global tabs)
  tabs: string[];
  // Config keys this ERP needs (rendered in ERP Config panel)
  configFields: { key: string; label: string; type: 'text' | 'password' | 'url' | 'select'; hint?: string; options?: string[] }[];
  // Matching & resolution rules supported
  matching: string[];
}

export const ERP_REGISTRY: Record<string, ErpDefinition> = {
  'QuickBooks Online': {
    id: 'qbo',
    platformType: 'QuickBooks Online',
    label: 'QuickBooks Online',
    shortLabel: 'QBO',
    icon: Zap,
    color: 'amber',
    description: 'OAuth2 REST API, CDC webhooks, sparse writeback of IRN/QR to QBO invoice custom fields.',
    tabs: ['overview', 'invoices', 'import', 'customers', 'items', 'validation', 'connectors', 'mapping', 'gateway'],
    configFields: [
      { key: 'realmId', label: 'QBO Company ID (Realm)', type: 'text', hint: '913035...' },
      { key: 'environment', label: 'Environment', type: 'select', options: ['sandbox', 'production'] },
    ],
    matching: ['QBO DocNumber ↔ clientInvoiceNumber', 'CustomerRef ↔ customerCode', 'ItemRef ↔ clientSku', 'HS code auto-fill when UNMAPPED'],
  },
  'Excel & CSV Import': {
    id: 'excel',
    platformType: 'Excel & CSV Import',
    label: 'Excel & CSV',
    shortLabel: 'Excel',
    icon: FileSpreadsheet,
    color: 'indigo',
    description: 'Legacy drag-drop .xlsx/.csv — removed in ERP gateway (QBO | Odoo only).',
    comingSoon: true,
    tabs: ['overview'],
    configFields: [],
    matching: [],
  },
  'Odoo ERP': {
    id: 'odoo',
    platformType: 'Odoo ERP',
    label: 'Odoo ERP',
    shortLabel: 'Odoo',
    icon: Layers,
    color: 'violet',
    description: 'JSON-RPC (execute_kw) — pulls posted invoices from account.move, writes IRN/QR back via chatter.',
    tabs: ['overview', 'invoices', 'import', 'customers', 'items', 'validation', 'connectors', 'mapping', 'gateway'],
    configFields: [
      { key: 'odooUrl', label: 'Odoo URL', type: 'url', hint: 'https://odoo.example.com' },
      { key: 'database', label: 'Database', type: 'text', hint: 'odoo_prod' },
      { key: 'odooUsername', label: 'Username / Email', type: 'text', hint: 'integration@client.com' },
      { key: 'odooApiKey', label: 'API Key', type: 'password', hint: 'Generated under Settings → Users → API Keys' },
    ],
    matching: ['name ↔ clientInvoiceNumber', 'partner_id ↔ customerCode/TIN (via res.partner.vat)', 'product_id display name ↔ clientSku', 'price_total − price_subtotal ↔ vatAmount'],
  },
};

export const ALL_ERPS = Object.values(ERP_REGISTRY);

export function getErpForTenant(platformType?: string): ErpDefinition {
  if (!platformType) return ERP_REGISTRY['QuickBooks Online'];
  return ERP_REGISTRY[platformType] || {
    id: 'generic' as ErpId,
    platformType: platformType,
    label: platformType,
    shortLabel: platformType.slice(0, 4).toUpperCase(),
    icon: Layers,
    color: 'slate',
    description: 'Generic ERP adapter.',
    tabs: ['overview', 'invoices', 'import', 'customers', 'items', 'validation', 'mapping', 'gateway'],
    configFields: [],
    matching: [],
  };
}

export function groupTenantsByErp(tenants: { platformType: string }[]) {
  const groups: Record<string, typeof tenants> = {};
  for (const t of tenants) {
    const erp = getErpForTenant(t.platformType);
    const key = erp.label;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  return groups;
}

