export type TenantId = 'tenant_qbo' | 'tenant_excel' | string;

export interface TenantErp {
  id: string;
  tenantId: TenantId;
  platformType: string;
  erpId: string;
  displayName?: string | null;
  config?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'NEEDS_REAUTH';
  lastSyncAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: TenantId;
  name: string;
  companyName: string;
  tin: string;
  platformType: 'QuickBooks Online' | 'Odoo ERP' | string;
  region?: string;
  marketTier: 'Tier 1 (SMB)' | 'Tier 2 (Mid-Market)' | 'Tier 3 (Enterprise)' | string;
  cittaApiKey?: string;
  cittaApiSecretEncrypted?: string;
  cittaGatewayUrl?: string | null;
  cittaWritebackTarget?: 'HUB' | 'CITTAEFS' | 'BOTH';
  erpConfig?: string | null;
  onboardingStatus: 'SANDBOX_TESTING' | 'NRS_VERIFIED' | 'LIVE_PRODUCTION' | 'PENDING_MAPPING' | 'VERIFIED_READY';
  monthlyAllowance: number;
  monthlyUsed: number;
  defaultVatRate: number;
  lastSyncAt: string;
  tenantErps?: TenantErp[];
}

export type InvoiceKind = 'B2B' | 'B2C' | 'B2G' | 'EXPORT';
export type InvoiceType = 'STANDARD' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
export type InvoiceStatus = 'QUEUED' | 'PENDING_NRS_STAMP' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'REJECTED_BANK';

export interface InvoiceLineItem {
  id: string;
  itemCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxableAmount: number;
  vatRate: number; // e.g. 16 for 16%
  vatAmount: number;
  totalAmount: number;
  hsOrServiceCode: string;
  codeType: 'HS_CODE' | 'SERVICE_CODE' | 'UNMAPPED';
}

export interface Invoice {
  id: string;
  tenantId: TenantId;
  sourceErp?: string | null; // which ERP this invoice originated from (multi-ERP per tenant)
  odooInvoiceId?: string; // immutable Odoo account.move id when sourceErp=odoo
  clientInvoiceNumber: string;
  documentNumber?: string; // spec: distinct, optional sequential document reference
  invoiceType: InvoiceType;
  invoiceKind: InvoiceKind;
  issueDate: string; // YYYY-MM-DD
  dueDate: string;
  originalIrn?: string; // required for Credit/Debit notes
  
  // Customer info
  customerCode: string;
  customerName: string;
  customerTin?: string;
  customerAddress?: string;

  // Currency & Amounts
  currency: string;
  subtotal: number;
  totalVat: number;
  totalDiscount: number;
  grandTotal: number;

  lineItems: InvoiceLineItem[];

  // CittaEFS / NRS Gateway fields
  irn?: string;
  qrCodeUrl?: string;
  verificationLink?: string;
  nrsStampTimestamp?: string;
  pdfSignedUrl?: string;

  // Lifecycle & Ledger status
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  bankReferenceId?: string;
  ledgerWritebackStatus: 'PENDING' | 'SYNCED' | 'FAILED';
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// Matches GET /api/customers after formatCustomer (src/lib/serverHelpers.ts).
// Nullable on purpose: the hub only holds what the ERP actually sent.
export interface CustomerProfile {
  id: string;
  tenantId: TenantId;
  clientCustomerCode: string | null;
  cittaCustomerCode: string | null; // CittaEFS-issued ID; null until registered
  name: string | null;
  tin: string | null;
  isB2B: boolean;
  street: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  tinValidationStatus: 'VALIDATED' | 'INVALID_FORMAT' | 'UNVERIFIED';
  lastSyncedAt: string | null;
}

// Matches GET /api/items/mappings: raw Item columns plus the computed
// MAPPED/UNMAPPED status (src/routes/items.ts).
export interface ItemCodeMapping {
  id: string;
  tenantId: TenantId;
  clientSku: string;
  name: string | null;
  description: string;
  unitCode: string;
  hsOrServiceCode: string;
  categoryType: string;
  defaultVatRate: number;
  taxCategoryCode: string | null;
  productCategory: string | null;
  isService: boolean;
  status: 'MAPPED' | 'UNMAPPED';
  createdAt: string;
  updatedAt: string;
}

// Thin-hub pivot (docs/CittaHub_Revision_Plan.md): tracks whether a customer
// or item seen from a client ERP has been registered with CittaEFS — CittaEFS
// owns the actual record, the Hub only tracks a reference.
export interface EntityMapping {
  id: string;
  tenantId: TenantId;
  entityType: 'CUSTOMER' | 'ITEM';
  sourceErp: string;
  sourceErpId: string;
  displayName: string | null;
  tin: string | null;
  cittaReferenceCode: string | null;
  status: 'PENDING_REGISTRATION' | 'MAPPED';
  createdAt: string;
  updatedAt: string;
}

export interface ValidationErrorItem {
  id: string;
  tenantId: TenantId;
  clientInvoiceNumber: string;
  errorCategory: 'MISSING_HS_CODE' | 'INVALID_TIN_FORMAT' | 'INVALID_DATE' | 'MISSING_B2B_TIN' | 'TAX_MISMATCH' | 'DUPLICATE_INVOICE' | 'GATEWAY_REJECTED' | 'GATEWAY_NOT_CONFIGURED' | 'TRANSMIT_FAILED';
  fieldAffected: string;
  errorMessage: string;
  rawPayloadSample: any;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  createdAt: string;
}

// Matches GET /api/audit-logs (src/routes/auditLogs.ts). `rawJson` is
// deliberately absent: it can contain full tenant records including key
// material, so the API never returns it.
export interface AuditLogEntry {
  id: string;
  tenantId: TenantId;
  action: string;
  entityType: string;
  entityRef: string;
  details: string;
  sha256PayloadHash: string;
  performedBy: string;
  createdAt: string;
}

export interface QueueJob {
  id: string;
  tenantId: TenantId;
  invoiceNumber: string;
  type: 'CITTA_TRANSMIT' | 'RECONCILE_STAMP' | 'CDC_SYNC' | 'LEDGER_WRITEBACK';
  attempts: number;
  maxAttempts: number;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  lastError?: string;
  scheduledAt: string;
}

export interface MetricsByErp {
  sourceErp: string;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  successRate: number;
}

export interface MetricsTimeseriesPoint {
  date: string;
  qbo: number;
  odoo: number;
  total: number;
}

export interface ErpHealthRow {
  id: string;
  erpId: string;
  displayName: string | null;
  companyId: string | null;
  status: string;
  lastSyncAt: string | null;
  lagSec: number | null;
}

export interface SystemMetrics {
  totalInvoicesProcessed: number;
  nrsStampSuccessRate: number; // percent, e.g. 99.8
  averageLatencyMs: number;
  activeTenantsCount: number;
  pendingValidationCount: number;
  reconciliationCronStatus: 'HEALTHY' | 'RUNNING' | 'ATTENTION';
  cittaGatewayStatus: 'ONLINE' | 'DEGRADED' | 'UNKNOWN';
  byErp?: MetricsByErp[];
  timeseries?: MetricsTimeseriesPoint[];
  erpHealth?: ErpHealthRow[];
}

export type UserRole = 'ADMIN' | 'OPERATOR';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organization: string;
  loginAt: string;
}


