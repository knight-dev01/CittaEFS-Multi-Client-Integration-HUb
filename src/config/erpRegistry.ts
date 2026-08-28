import { Zap, FileSpreadsheet, Building2, Layers, Database, Cloud } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ErpId = 'qbo' | 'excel' | 'sap' | 'netsuite' | 'odoo' | 'custom_sql' | 'generic';

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
    description: 'Drag-drop .xlsx/.csv, grouped by clientInvoiceNumber, HS/VAT normalisation, manual Master Data mapping.',
    tabs: ['overview', 'invoices', 'import', 'customers', 'items', 'validation', 'mapping', 'gateway'],
    configFields: [
      { key: 'sheetName', label: 'Expected Sheet Name', type: 'text', hint: 'Invoice Template' },
      { key: 'csvDelimiter', label: 'CSV Delimiter', type: 'select', options: [',', ';', '\\t'] },
    ],
    matching: ['Invoice Number ↔ clientInvoiceNumber (grouped rows)', 'Customer Name/TIN ↔ Customer directory', 'SKU/HS ↔ Item dictionary', 'Preview before gateway send'],
  },
  'SAP S/4HANA': {
    id: 'sap',
    platformType: 'SAP S/4HANA',
    label: 'SAP S/4HANA',
    shortLabel: 'SAP',
    icon: Building2,
    color: 'slate',
    description: 'OData REST (API_INVOICE_SRV) with CSRF handshake — coming soon.',
    comingSoon: true,
    tabs: ['overview', 'mapping', 'gateway'],
    configFields: [
      { key: 'odataBaseUrl', label: 'OData Base URL', type: 'url', hint: 'https://host/sap/opu/odata/sap/API_INVOICE_SRV' },
      { key: 'client', label: 'SAP Client', type: 'text', hint: '100' },
    ],
    matching: ['BillingDocument ↔ clientInvoiceNumber', 'SoldToParty ↔ customerCode', 'Material ↔ clientSku'],
  },
  'NetSuite': {
    id: 'netsuite',
    platformType: 'NetSuite',
    label: 'NetSuite SuiteTalk',
    shortLabel: 'NS',
    icon: Cloud,
    color: 'slate',
    description: 'RESTlets with Token-Based Auth (TBA / HMAC-SHA256) — coming soon.',
    comingSoon: true,
    tabs: ['overview', 'mapping', 'gateway'],
    configFields: [
      { key: 'accountId', label: 'Account ID', type: 'text', hint: '123456' },
      { key: 'roleId', label: 'Role ID', type: 'text', hint: '3' },
    ],
    matching: ['tranId ↔ clientInvoiceNumber', 'entity ↔ customerCode', 'item ↔ clientSku'],
  },
  'Odoo ERP': {
    id: 'odoo',
    platformType: 'Odoo ERP',
    label: 'Odoo ERP',
    shortLabel: 'Odoo',
    icon: Layers,
    color: 'slate',
    description: 'JSON-RPC context endpoint — coming soon.',
    comingSoon: true,
    tabs: ['overview', 'mapping', 'gateway'],
    configFields: [
      { key: 'odooUrl', label: 'Odoo URL', type: 'url', hint: 'https://odoo.example.com' },
      { key: 'database', label: 'Database', type: 'text', hint: 'odoo_prod' },
    ],
    matching: ['name ↔ clientInvoiceNumber', 'partner_id ↔ customerCode', 'product_id ↔ clientSku'],
  },
  'Custom SQL': {
    id: 'custom_sql',
    platformType: 'Custom SQL',
    label: 'Custom SQL Staging',
    shortLabel: 'SQL',
    icon: Database,
    color: 'slate',
    description: 'PostgreSQL / SQL Server staging view vw_pending_invoices — coming soon.',
    comingSoon: true,
    tabs: ['overview', 'mapping', 'gateway'],
    configFields: [
      { key: 'connectionString', label: 'Connection String', type: 'password', hint: 'postgresql://...' },
      { key: 'viewName', label: 'Staging View', type: 'text', hint: 'vw_pending_invoices' },
    ],
    matching: ['inv_num ↔ clientInvoiceNumber', 'cust_name ↔ customerCode', 'sku_code ↔ clientSku'],
  },
};

export const ALL_ERPS = Object.values(ERP_REGISTRY);

export function getErpForTenant(platformType?: string): ErpDefinition {
  if (!platformType) return ERP_REGISTRY['Excel & CSV Import'];
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

