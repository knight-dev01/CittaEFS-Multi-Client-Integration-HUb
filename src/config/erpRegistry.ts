import {
  Zap,
  Layers,
  Wallet,
  Briefcase,
  Landmark,
  FileSpreadsheet,
  Building2,
  Database,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ErpId =
  | 'qbo'
  | 'odoo'
  | 'xero'
  | 'zoho'
  | 'sage'
  | 'tally'
  | 'sap'
  | 'custom'
  | 'generic';

export type ErpAvailability = 'live' | 'planned';

export interface ErpDefinition {
  id: ErpId;
  platformType: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  color: string;
  description: string;
  availability: ErpAvailability;
  // Which hub tabs this ERP shows (subset of global tabs)
  tabs: string[];
  // Config keys this ERP needs (rendered in ERP Config panel)
  configFields: { key: string; label: string; type: 'text' | 'password' | 'url' | 'select'; hint?: string; options?: string[] }[];
  // Matching & resolution rules supported
  matching: string[];
  // Adapter contract metadata
  authMethod?: string;
  apiStyle?: string;
  coreObjects?: string[];
  quirks?: string[];
  smokeTest?: string[];
  doNot?: string[];
  docsPath?: string;
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
    availability: 'live',
    docsPath: 'docs/erp-adapters/quickbooks.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'realmId', label: 'QBO Company ID (Realm)', type: 'text', hint: '913035...' },
      { key: 'environment', label: 'Environment', type: 'select', options: ['sandbox', 'production'] },
    ],
    matching: ['QBO DocNumber ↔ clientInvoiceNumber', 'CustomerRef ↔ customerCode', 'ItemRef ↔ clientSku', 'HS code auto-fill when UNMAPPED'],
    authMethod: 'OAuth 2.0 Authorization Code with refresh token',
    apiStyle: 'REST JSON, Intuit v3, CDC webhooks',
    coreObjects: ['Customer', 'Invoice', 'Item', 'Payment'],
    quirks: ['500 req/min per realm, 429 Retry-After', 'realmId required per URL, sandbox vs prod differs', 'paging STARTPOSITION/MAXRESULTS 1000', 'CDC webhook HMAC signature'],
    smokeTest: ['GET companyinfo', 'Query one Invoice by DocNumber', 'Writeback IRN/QR to custom fields'],
    doNot: ['Hardcode realmId or environment', 'Match customers by name', 'Assume TaxCode mandatory', 'Create items in QBO from hub'],
  },
  'Odoo ERP': {
    id: 'odoo',
    platformType: 'Odoo ERP',
    label: 'Odoo ERP',
    shortLabel: 'Odoo',
    icon: Layers,
    color: 'violet',
    description: 'JSON-RPC (execute_kw) — pulls posted invoices from account.move, writes IRN/QR back via chatter.',
    availability: 'live',
    docsPath: 'docs/erp-adapters/odoo.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'odooUrl', label: 'Odoo URL', type: 'url', hint: 'https://odoo.example.com' },
      { key: 'database', label: 'Database', type: 'text', hint: 'odoo_prod' },
      { key: 'odooUsername', label: 'Username / Email', type: 'text', hint: 'integration@client.com' },
      { key: 'odooApiKey', label: 'API Key', type: 'password', hint: 'Generated under Settings → Users → API Keys' },
    ],
    matching: ['name ↔ clientInvoiceNumber', 'partner_id ↔ customerCode/TIN (via res.partner.vat)', 'product_id display name ↔ clientSku', 'price_total − price_subtotal ↔ vatAmount'],
    authMethod: 'API Key + Database + Username, XML-RPC/JSON-RPC',
    apiStyle: 'JSON-RPC execute_kw, xmlrpc/2/common & object',
    coreObjects: ['res.partner', 'account.move', 'account.move.line'],
    quirks: ['Static API key, no refresh', 'Pagination offset/limit 100', 'incremental cursor write_date', 'writeback via chatter, no custom field guarantee'],
    smokeTest: ['Authenticate to get uid', 'Read one res.partner', 'Fetch one posted account.move'],
    doNot: ['Use password authentication', 'Create invoices without product/tax mapping', 'Assume name is unique'],
  },
  'Xero': {
    id: 'xero',
    platformType: 'Xero',
    label: 'Xero',
    shortLabel: 'Xero',
    icon: Wallet,
    color: 'sky',
    description: 'OAuth2 REST API for UK/AU/NG clients — contacts, invoices and payments.',
    availability: 'planned',
    docsPath: 'docs/erp-adapters/planned-erps.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'tenantId', label: 'Xero Tenant ID', type: 'text', hint: 'Sent as Xero-tenant-id on every call' },
      { key: 'environment', label: 'Environment', type: 'select', options: ['demo', 'production'] },
    ],
    matching: ['InvoiceNumber ↔ clientInvoiceNumber', 'Contact.ContactID ↔ customerCode', 'LineItem.ItemCode ↔ clientSku'],
    authMethod: 'OAuth 2.0 with PKCE; tenant_id header',
    apiStyle: 'REST JSON, 60 requests/min per tenant',
    coreObjects: ['Contact', 'Invoice', 'Payment'],
    quirks: ['Xero-tenant-id required on every call', 'Rate limit 60/min', 'Tax types are codes such as OUTPUT2 and NONE'],
    smokeTest: ['List one Contact', 'Create a draft Invoice'],
    doNot: ['Forget tenant_id', 'Assume tax is a percentage'],
  },
  'Zoho Books': {
    id: 'zoho',
    platformType: 'Zoho Books',
    label: 'Zoho Books',
    shortLabel: 'Zoho',
    icon: Briefcase,
    color: 'rose',
    description: 'OAuth2 REST API for SMBs — customers, invoices and customer payments.',
    availability: 'planned',
    docsPath: 'docs/erp-adapters/planned-erps.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'organizationId', label: 'Organization ID', type: 'text', hint: 'Required on every call' },
      { key: 'dataCenter', label: 'Data Centre', type: 'select', options: ['com', 'eu', 'in', 'com.au', 'jp'] },
    ],
    matching: ['invoice_number ↔ clientInvoiceNumber', 'customer_id ↔ customerCode', 'item_id ↔ clientSku'],
    authMethod: 'OAuth 2.0; organization_id parameter',
    apiStyle: 'REST JSON',
    coreObjects: ['Customer', 'Invoice', 'Customer Payment'],
    quirks: ['Lower rate limits than QBO', 'organization_id required on every call', 'item_id required, not just an item name'],
    smokeTest: ['List Customers for the organization', 'Create an Invoice with an existing Item'],
    doNot: ['Create items on the fly', 'Rely on item names instead of ids'],
  },
  'Sage Business Cloud': {
    id: 'sage',
    platformType: 'Sage Business Cloud',
    label: 'Sage Business Cloud',
    shortLabel: 'Sage',
    icon: Landmark,
    color: 'emerald',
    description: 'Business Cloud REST API; Sage 50 Desktop is a file/SData sync, not real time.',
    availability: 'planned',
    docsPath: 'docs/erp-adapters/planned-erps.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'businessId', label: 'Sage Business ID', type: 'text' },
      { key: 'product', label: 'Product', type: 'select', options: ['Business Cloud', 'Sage 50 Desktop'] },
    ],
    matching: ['invoice_number ↔ clientInvoiceNumber', 'contact_id ↔ customerCode'],
    authMethod: 'Business Cloud: OAuth 2.0. Sage 50 Desktop: SData or file export',
    apiStyle: 'Business Cloud REST; Desktop file/SData',
    coreObjects: ['Customer', 'Sales Invoice', 'Receipt'],
    quirks: ['Desktop has no reliable real-time API', 'Versions and fields differ per country', 'Scheduled file sync is the honest desktop mode'],
    smokeTest: ['Cloud: list customers', 'Desktop: CSV export/import round trip'],
    doNot: ['Promise real-time sync for Sage 50 Desktop'],
  },
  'Tally Prime': {
    id: 'tally',
    platformType: 'Tally Prime',
    label: 'Tally Prime',
    shortLabel: 'Tally',
    icon: FileSpreadsheet,
    color: 'orange',
    description: 'Local XML over HTTP on port 9000 — ledgers and sales vouchers, per machine.',
    availability: 'planned',
    docsPath: 'docs/erp-adapters/planned-erps.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'tallyUrl', label: 'Tally URL', type: 'url', hint: 'http://localhost:9000' },
      { key: 'companyName', label: 'Company Name', type: 'text', hint: 'Must match Tally exactly' },
    ],
    matching: ['Voucher Number ↔ clientInvoiceNumber', 'Ledger Name ↔ customerCode'],
    authMethod: 'None; local HTTP endpoint',
    apiStyle: 'XML request/response over HTTP POST',
    coreObjects: ['Ledger', 'Sales Voucher'],
    quirks: ['No REST API', 'Brittle XML', 'Tally must be running with port 9000 open', 'Exact company name required'],
    smokeTest: ['Create one Sales Voucher in a test company'],
    doNot: ['Use as a cloud multi-tenant connector', 'Assume it works without the local Tally process'],
  },
  'SAP Business One': {
    id: 'sap',
    platformType: 'SAP Business One',
    label: 'SAP Business One',
    shortLabel: 'SAP B1',
    icon: Building2,
    color: 'slate',
    description: 'Service Layer REST/OData with heavy auth and business-partner mapping.',
    availability: 'planned',
    docsPath: 'docs/erp-adapters/planned-erps.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'serviceLayerUrl', label: 'Service Layer URL', type: 'url' },
      { key: 'companyDb', label: 'Company Database', type: 'text' },
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    matching: ['DocNum ↔ clientInvoiceNumber', 'CardCode ↔ customerCode', 'ItemCode ↔ clientSku'],
    authMethod: 'Service Layer session with Basic Auth or OAuth',
    apiStyle: 'OData / REST Service Layer',
    coreObjects: ['BusinessPartner', 'Invoices (OINV)', 'IncomingPayments'],
    quirks: ['Heavy auth', 'Complex tax and business-partner mapping', 'Needs B1i/DI setup', 'Expensive to test'],
    smokeTest: ['Log in and get a session', 'Read one BusinessPartner'],
    doNot: ['Build this before simpler ERPs', 'Start with S/4 instead of B1'],
  },
  'Custom ERP': {
    id: 'custom',
    platformType: 'Custom ERP',
    label: 'Custom ERP',
    shortLabel: 'Custom',
    icon: Database,
    color: 'teal',
    description: 'Client database or bespoke REST API — schema must be discovered before mapping.',
    availability: 'planned',
    docsPath: 'docs/erp-adapters/planned-erps.md',
    tabs: ['connections', 'invoices'],
    configFields: [
      { key: 'baseUrl', label: 'Base URL / Host', type: 'url' },
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'dialect', label: 'Database', type: 'select', options: ['MySQL', 'MSSQL', 'PostgreSQL'] },
    ],
    matching: ['Discovered per client: customers, invoices, invoice_items'],
    authMethod: 'Database credentials or their own REST API key',
    apiStyle: 'Direct SQL or custom REST',
    coreObjects: ['customers', 'invoices', 'invoice_items'],
    quirks: ['No documentation', 'Schema changes break the mapping', 'No webhooks'],
    smokeTest: ['Read-only: list tables, find the invoice table, map columns'],
    doNot: ['Write directly without a mapping table and backup', 'Skip a staging table'],
  },
};

export const LIVE_ERPS: ErpDefinition[] = Object.values(ERP_REGISTRY).filter(
  (erp) => erp.availability === 'live',
);

export const PLANNED_ERPS: ErpDefinition[] = Object.values(ERP_REGISTRY).filter(
  (erp) => erp.availability === 'planned',
);

export function getErpForTenant(platformType?: string): ErpDefinition {
  if (!platformType) return ERP_REGISTRY['QuickBooks Online'];
  return ERP_REGISTRY[platformType] || {
    id: 'generic' as ErpId,
    platformType: platformType,
    label: platformType,
    shortLabel: platformType.slice(0, 4).toUpperCase(),
    icon: Layers,
    color: 'slate',
    description: 'Unregistered ERP platform — no adapter contract exists for this name.',
    availability: 'planned',
    tabs: ['connections', 'invoices'],
    configFields: [],
    matching: [],
  };
}

export function isErpAvailable(platformType?: string): boolean {
  return getErpForTenant(platformType).availability === 'live';
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
