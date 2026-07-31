import { Tenant, Invoice, CustomerProfile, ItemCodeMapping, ValidationErrorItem, AuditLog, QueueJob, SystemMetrics } from '../types';

export const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant_qbo_smb',
    name: 'Acme Retail & Distro',
    companyName: 'Acme Retail Solutions Ltd',
    tin: 'P051239841A',
    platformType: 'QuickBooks Online',
    marketTier: 'Tier 1 (SMB)',
    cittaApiKey: 'citta_live_ak9832_acme_prod',
    onboardingStatus: 'LIVE_PRODUCTION',
    monthlyAllowance: 1000,
    monthlyUsed: 384,
    lastSyncAt: '2026-07-27 09:42:10'
  },
  {
    id: 'tenant_sap_ent',
    name: 'Global Tech Corp',
    companyName: 'Global Technology Enterprise Inc',
    tin: 'P098877112B',
    platformType: 'SAP S/4HANA',
    marketTier: 'Tier 3 (Enterprise)',
    cittaApiKey: 'citta_live_gt8810_global_prod',
    onboardingStatus: 'NRS_VERIFIED',
    monthlyAllowance: 50000,
    monthlyUsed: 14200,
    lastSyncAt: '2026-07-27 10:01:05'
  },
  {
    id: 'tenant_sql_legacy',
    name: 'Apex Logistics & Freight',
    companyName: 'Apex Heavy Logistics Ltd',
    tin: 'P011223344C',
    platformType: 'Legacy SQL DB',
    marketTier: 'Tier 3 (Enterprise)',
    cittaApiKey: 'citta_sand_px1102_apex_stg',
    onboardingStatus: 'SANDBOX_TESTING',
    monthlyAllowance: 10000,
    monthlyUsed: 1250,
    lastSyncAt: '2026-07-27 08:15:30'
  },
  {
    id: 'tenant_csv_drop',
    name: 'Metro Wholesale Traders',
    companyName: 'Metro Wholesale Trading Co',
    tin: 'P077665544D',
    platformType: 'CSV / Excel Drop',
    marketTier: 'Tier 4 (Legacy/CSV)',
    cittaApiKey: 'citta_stg_mw3399_metro_demo',
    onboardingStatus: 'PENDING_MAPPING',
    monthlyAllowance: 2500,
    monthlyUsed: 120,
    lastSyncAt: '2026-07-26 18:30:00'
  }
];

export const CITTA_HS_CODES_REFERENCE = [
  { code: 'HS-8471.30', name: 'Portable automatic data processing machines / Laptops', type: 'HS_CODE', defaultVat: 16 },
  { code: 'HS-8517.62', name: 'Machines for reception, conversion & transmission of data / Routers & Switches', type: 'HS_CODE', defaultVat: 16 },
  { code: 'HS-7304.11', name: 'Line pipe of stainless steel for oil & gas', type: 'HS_CODE', defaultVat: 16 },
  { code: 'HS-3926.90', name: 'Articles of plastics / Industrial packaging', type: 'HS_CODE', defaultVat: 16 },
  { code: 'HS-4819.10', name: 'Cartons, boxes and cases of corrugated paper', type: 'HS_CODE', defaultVat: 16 },
  { code: 'HS-1006.30', name: 'Semi-milled or wholly milled rice / Staple Food (Zero Rated)', type: 'HS_CODE', defaultVat: 0 },
  { code: 'HS-3004.90', name: 'Medicaments for therapeutic or prophylactic uses (Exempt)', type: 'HS_CODE', defaultVat: 0 }
];

export const CITTA_SERVICE_CODES_REFERENCE = [
  { code: 'SRV-7212.10', name: 'Software Installation, Cloud Support & IT Integration Services', type: 'SERVICE_CODE', defaultVat: 16 },
  { code: 'SRV-7414.00', name: 'Professional Accounting, Fiscal Compliance & Tax Advisory', type: 'SERVICE_CODE', defaultVat: 16 },
  { code: 'SRV-8703.20', name: 'Freight Transportation, Haulage & Intermodal Logistics', type: 'SERVICE_CODE', defaultVat: 16 },
  { code: 'SRV-6202.90', name: 'Technical Equipment Maintenance & Repair Services', type: 'SERVICE_CODE', defaultVat: 16 },
  { code: 'SRV-8010.15', name: 'Corporate Legal Consulting & Compliance Review Services', type: 'SERVICE_CODE', defaultVat: 16 }
];

export const INITIAL_ITEM_MAPPINGS: ItemCodeMapping[] = [];

export const INITIAL_CUSTOMERS: CustomerProfile[] = [];

export const INITIAL_INVOICES: Invoice[] = [];

export const INITIAL_VALIDATION_ERRORS: ValidationErrorItem[] = [];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [];

export const INITIAL_METRICS: SystemMetrics = {
  totalInvoicesProcessed: 0,
  nrsStampSuccessRate: 100.0,
  averageLatencyMs: 0,
  activeTenantsCount: 1,
  pendingValidationCount: 0,
  reconciliationCronStatus: 'HEALTHY',
  cittaGatewayStatus: 'ONLINE'
};
