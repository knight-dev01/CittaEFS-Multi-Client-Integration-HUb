import { Tenant, Invoice, CustomerProfile, ItemCodeMapping, ValidationErrorItem, AuditLog, QueueJob, SystemMetrics } from '../types';

export const INITIAL_TENANTS: Tenant[] = [];

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
  activeTenantsCount: 0,
  pendingValidationCount: 0,
  reconciliationCronStatus: 'HEALTHY',
  cittaGatewayStatus: 'ONLINE'
};
