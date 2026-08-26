export type TenantId = 'tenant_qbo' | 'tenant_excel' | string;

export interface Tenant {
  id: TenantId;
  name: string;
  companyName: string;
  tin: string;
  platformType: 'QuickBooks Online' | 'SAP S/4HANA' | 'Microsoft Dynamics 365' | 'Xero' | string;
  region?: string;
  marketTier: 'Tier 1 (SMB)' | 'Tier 2 (Mid-Market)' | 'Tier 3 (Enterprise)' | string;
  cittaApiKey?: string;
  cittaApiSecretEncrypted?: string;
  onboardingStatus: 'SANDBOX_TESTING' | 'NRS_VERIFIED' | 'LIVE_PRODUCTION' | 'PENDING_MAPPING' | 'VERIFIED_READY';
  monthlyAllowance: number;
  monthlyUsed: number;
  defaultVatRate: number;
  lastSyncAt: string;
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
  clientInvoiceNumber: string;
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

export interface CustomerProfile {
  id: string;
  tenantId: TenantId;
  clientCustomerCode: string;
  cittaCustomerCode: string;
  name: string;
  tin: string;
  isB2B: boolean;
  address: string;
  city: string;
  email: string;
  phone: string;
  tinValidationStatus: 'VALIDATED' | 'INVALID_FORMAT' | 'UNVERIFIED';
  lastSyncedAt: string;
}

export interface ItemCodeMapping {
  id: string;
  tenantId: TenantId;
  clientSku: string;
  description: string;
  category: string;
  hsOrServiceCode: string;
  codeType: 'HS_CODE' | 'SERVICE_CODE';
  codeDescription: string;
  defaultVatRate: number;
  status: 'MAPPED' | 'UNMAPPED' | 'NEEDS_REVIEW';
  updatedAt: string;
}

export interface ValidationErrorItem {
  id: string;
  tenantId: TenantId;
  clientInvoiceNumber: string;
  errorCategory: 'MISSING_HS_CODE' | 'INVALID_TIN_FORMAT' | 'INVALID_DATE' | 'MISSING_B2B_TIN' | 'TAX_MISMATCH';
  fieldAffected: string;
  errorMessage: string;
  rawPayloadSample: any;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  createdAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: TenantId;
  action: 'INVOICE_INGESTED' | 'PAYLOAD_GENERATED' | 'CITTA_SUBMITTED' | 'WEBHOOK_RECEIVED' | 'LEDGER_WRITEBACK' | 'CODE_MAPPED' | 'RECONCILIATION_RUN' | 'TENANT_ONBOARDED';
  entityType: 'INVOICE' | 'CUSTOMER' | 'ITEM_MAPPING' | 'SYSTEM' | 'TENANT';
  entityRef: string;
  details: string;
  sha256PayloadHash: string;
  performedBy: string;
  timestamp: string;
  rawJson?: any;
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

export interface SystemMetrics {
  totalInvoicesProcessed: number;
  nrsStampSuccessRate: number; // e.g. 99.8
  averageLatencyMs: number;
  activeTenantsCount: number;
  pendingValidationCount: number;
  reconciliationCronStatus: 'HEALTHY' | 'RUNNING' | 'ATTENTION';
  cittaGatewayStatus: 'ONLINE' | 'DEGRADED';
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

export interface Connector {
  id: string;
  tenantId: TenantId;
  platform: string;
  type: string;
  auth: string;
  status: 'HEALTHY' | 'WARNING' | 'ERROR' | 'TESTING';
  endpoint: string;
  latencyMs: number;
  lastSync: string;
  syncedInvoices: number;
  environment?: 'SANDBOX' | 'PRODUCTION';
  syncInterval?: string;
}

