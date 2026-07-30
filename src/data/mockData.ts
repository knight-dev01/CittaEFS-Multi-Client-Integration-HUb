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

export const INITIAL_ITEM_MAPPINGS: ItemCodeMapping[] = [
  {
    id: 'map_01',
    tenantId: 'tenant_qbo_smb',
    clientSku: 'SKU-LAP-DELL15',
    description: 'Dell XPS 15 Business Laptop 32GB RAM',
    category: 'Hardware Goods',
    hsOrServiceCode: 'HS-8471.30',
    codeType: 'HS_CODE',
    codeDescription: 'Portable automatic data processing machines / Laptops',
    defaultVatRate: 16,
    status: 'MAPPED',
    updatedAt: '2026-07-25 14:20:00'
  },
  {
    id: 'map_02',
    tenantId: 'tenant_qbo_smb',
    clientSku: 'SKU-IT-ONBOARDING',
    description: 'Enterprise IT Setup & Cloud Onboarding Service',
    category: 'Professional Services',
    hsOrServiceCode: 'SRV-7212.10',
    codeType: 'SERVICE_CODE',
    codeDescription: 'Software Installation, Cloud Support & IT Integration Services',
    defaultVatRate: 16,
    status: 'MAPPED',
    updatedAt: '2026-07-26 10:11:00'
  },
  {
    id: 'map_03',
    tenantId: 'tenant_sap_ent',
    clientSku: 'SAP-MAT-9901',
    description: 'Stainless Steel Industrial Conduit Pipes 4-inch',
    category: 'Industrial Raw Materials',
    hsOrServiceCode: 'HS-7304.11',
    codeType: 'HS_CODE',
    codeDescription: 'Line pipe of stainless steel for oil & gas',
    defaultVatRate: 16,
    status: 'MAPPED',
    updatedAt: '2026-07-20 09:00:00'
  },
  {
    id: 'map_04',
    tenantId: 'tenant_sql_legacy',
    clientSku: 'LEG-FREIGHT-DIST',
    description: 'Regional Heavy Goods Haulage (30 Tons)',
    category: 'Logistics Services',
    hsOrServiceCode: 'SRV-8703.20',
    codeType: 'SERVICE_CODE',
    codeDescription: 'Freight Transportation, Haulage & Intermodal Logistics',
    defaultVatRate: 16,
    status: 'MAPPED',
    updatedAt: '2026-07-22 16:45:00'
  },
  {
    id: 'map_05',
    tenantId: 'tenant_csv_drop',
    clientSku: 'RAW-PLASTIC-PALLET',
    description: 'Heavy Duty Plastic Export Pallet Grade A',
    category: 'Packaging',
    hsOrServiceCode: 'UNMAPPED',
    codeType: 'HS_CODE',
    codeDescription: 'Pending HS Code assignment',
    defaultVatRate: 16,
    status: 'UNMAPPED',
    updatedAt: '2026-07-27 08:00:00'
  }
];

export const INITIAL_CUSTOMERS: CustomerProfile[] = [
  {
    id: 'cust_01',
    tenantId: 'tenant_qbo_smb',
    clientCustomerCode: 'QBO-CUST-1092',
    cittaCustomerCode: 'CUST-CITTA-8812',
    name: 'Zenith Logistics Ltd',
    tin: 'P019283746Z',
    isB2B: true,
    address: 'Plot 42, Industrial Avenue, Commercial Zone',
    city: 'Nairobi',
    email: 'billing@zenithlogistics.co.ke',
    phone: '+254711223344',
    tinValidationStatus: 'VALIDATED',
    lastSyncedAt: '2026-07-27 09:30:00'
  },
  {
    id: 'cust_02',
    tenantId: 'tenant_qbo_smb',
    clientCustomerCode: 'QBO-WALK-IN',
    cittaCustomerCode: 'CUST-B2C-GENERIC',
    name: 'Walk-in Retail Consumer',
    tin: 'N/A',
    isB2B: false,
    address: 'Point of Sale Counter 01',
    city: 'Nairobi',
    email: 'counter@acmeretail.com',
    phone: '+254700000000',
    tinValidationStatus: 'VALIDATED',
    lastSyncedAt: '2026-07-27 09:40:00'
  },
  {
    id: 'cust_03',
    tenantId: 'tenant_sap_ent',
    clientCustomerCode: 'SAP-CUST-900',
    cittaCustomerCode: 'CUST-CITTA-9001',
    name: 'Pan-African Energy Resources Ltd',
    tin: 'P088332211E',
    isB2B: true,
    address: 'Energy Towers, 14th Floor, Westlands',
    city: 'Nairobi',
    email: 'ap@panafricanenergy.com',
    phone: '+254722889900',
    tinValidationStatus: 'VALIDATED',
    lastSyncedAt: '2026-07-26 15:20:00'
  },
  {
    id: 'cust_04',
    tenantId: 'tenant_sql_legacy',
    clientCustomerCode: 'SQL-CUST-771',
    cittaCustomerCode: 'CUST-CITTA-7710',
    name: 'Highland Farms Products',
    tin: 'P000998877F',
    isB2B: true,
    address: 'Main Road 4, Nakuru Industrial Park',
    city: 'Nakuru',
    email: 'finance@highlandfarms.co.ke',
    phone: '+254733445566',
    tinValidationStatus: 'VALIDATED',
    lastSyncedAt: '2026-07-25 11:10:00'
  }
];

export const INITIAL_INVOICES: Invoice[] = [
  {
    id: 'inv_1001',
    tenantId: 'tenant_qbo_smb',
    clientInvoiceNumber: 'INV-2026-0089',
    invoiceType: 'STANDARD',
    invoiceKind: 'B2B',
    issueDate: '2026-07-27',
    dueDate: '2026-08-26',
    customerCode: 'CUST-CITTA-8812',
    customerName: 'Zenith Logistics Ltd',
    customerTin: 'P019283746Z',
    customerAddress: 'Plot 42, Industrial Avenue, Commercial Zone, Nairobi',
    currency: 'KES',
    subtotal: 250000.00,
    totalVat: 40000.00,
    totalDiscount: 10000.00,
    grandTotal: 280000.00,
    lineItems: [
      {
        id: 'li_101',
        itemCode: 'SKU-LAP-DELL15',
        description: 'Dell XPS 15 Business Laptop 32GB RAM',
        quantity: 2,
        unitPrice: 100000.00,
        discountAmount: 10000.00,
        taxableAmount: 190000.00,
        vatRate: 16,
        vatAmount: 30400.00,
        totalAmount: 220400.00,
        hsOrServiceCode: 'HS-8471.30',
        codeType: 'HS_CODE'
      },
      {
        id: 'li_102',
        itemCode: 'SKU-IT-ONBOARDING',
        description: 'Enterprise IT Setup & Cloud Onboarding Service',
        quantity: 1,
        unitPrice: 60000.00,
        discountAmount: 0,
        taxableAmount: 60000.00,
        vatRate: 16,
        vatAmount: 9600.00,
        totalAmount: 69600.00,
        hsOrServiceCode: 'SRV-7212.10',
        codeType: 'SERVICE_CODE'
      }
    ],
    irn: 'IRN-KE-2026-09882190-QBO',
    qrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-KE-2026-09882190-QBO',
    verificationLink: 'https://nrs.portal.gov/verify?irn=IRN-KE-2026-09882190-QBO',
    nrsStampTimestamp: '2026-07-27 09:42:15',
    pdfSignedUrl: 'https://cittaefs.com/docs/signed_INV-2026-0089.pdf',
    status: 'SIGNED',
    paymentStatus: 'PAID',
    bankReferenceId: 'BANK-TRX-99882210',
    ledgerWritebackStatus: 'SYNCED',
    createdAt: '2026-07-27 09:40:00',
    updatedAt: '2026-07-27 09:42:15'
  },
  {
    id: 'inv_1002',
    tenantId: 'tenant_qbo_smb',
    clientInvoiceNumber: 'INV-2026-0090',
    invoiceType: 'STANDARD',
    invoiceKind: 'B2C',
    issueDate: '2026-07-27',
    dueDate: '2026-07-27',
    customerCode: 'CUST-B2C-GENERIC',
    customerName: 'John Doe (Over-The-Counter)',
    currency: 'KES',
    subtotal: 120000.00,
    totalVat: 19200.00,
    totalDiscount: 0,
    grandTotal: 139200.00,
    lineItems: [
      {
        id: 'li_201',
        itemCode: 'SKU-LAP-DELL15',
        description: 'Dell XPS 15 Business Laptop 32GB RAM',
        quantity: 1,
        unitPrice: 120000.00,
        discountAmount: 0,
        taxableAmount: 120000.00,
        vatRate: 16,
        vatAmount: 19200.00,
        totalAmount: 139200.00,
        hsOrServiceCode: 'HS-8471.30',
        codeType: 'HS_CODE'
      }
    ],
    irn: 'IRN-KE-2026-09882191-QBO',
    qrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-KE-2026-09882191-QBO',
    verificationLink: 'https://nrs.portal.gov/verify?irn=IRN-KE-2026-09882191-QBO',
    nrsStampTimestamp: '2026-07-27 09:45:02',
    pdfSignedUrl: 'https://cittaefs.com/docs/signed_INV-2026-0090.pdf',
    status: 'APPROVED',
    paymentStatus: 'PAID',
    bankReferenceId: 'CASH-POS-1002',
    ledgerWritebackStatus: 'SYNCED',
    createdAt: '2026-07-27 09:44:00',
    updatedAt: '2026-07-27 09:45:02'
  },
  {
    id: 'inv_1003',
    tenantId: 'tenant_sap_ent',
    clientInvoiceNumber: 'SAP-9002100',
    invoiceType: 'STANDARD',
    invoiceKind: 'B2B',
    issueDate: '2026-07-27',
    dueDate: '2026-08-30',
    customerCode: 'CUST-CITTA-9001',
    customerName: 'Pan-African Energy Resources Ltd',
    customerTin: 'P088332211E',
    customerAddress: 'Energy Towers, 14th Floor, Westlands, Nairobi',
    currency: 'KES',
    subtotal: 1500000.00,
    totalVat: 240000.00,
    totalDiscount: 50000.00,
    grandTotal: 1690000.00,
    lineItems: [
      {
        id: 'li_301',
        itemCode: 'SAP-MAT-9901',
        description: 'Stainless Steel Industrial Conduit Pipes 4-inch',
        quantity: 100,
        unitPrice: 15000.00,
        discountAmount: 50000.00,
        taxableAmount: 1450000.00,
        vatRate: 16,
        vatAmount: 232000.00,
        totalAmount: 1682000.00,
        hsOrServiceCode: 'HS-7304.11',
        codeType: 'HS_CODE'
      }
    ],
    irn: 'IRN-KE-2026-100299-SAP',
    qrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-KE-2026-100299-SAP',
    verificationLink: 'https://nrs.portal.gov/verify?irn=IRN-KE-2026-100299-SAP',
    nrsStampTimestamp: '2026-07-27 10:01:10',
    pdfSignedUrl: 'https://cittaefs.com/docs/signed_SAP-9002100.pdf',
    status: 'SIGNED',
    paymentStatus: 'UNPAID',
    ledgerWritebackStatus: 'SYNCED',
    createdAt: '2026-07-27 10:00:00',
    updatedAt: '2026-07-27 10:01:10'
  },
  {
    id: 'inv_1004',
    tenantId: 'tenant_sql_legacy',
    clientInvoiceNumber: 'SQL-LEG-4029',
    invoiceType: 'CREDIT_NOTE',
    invoiceKind: 'B2B',
    issueDate: '2026-07-27',
    dueDate: '2026-07-27',
    originalIrn: 'IRN-KE-2026-09882190-QBO',
    customerCode: 'CUST-CITTA-7710',
    customerName: 'Highland Farms Products',
    customerTin: 'P000998877F',
    customerAddress: 'Main Road 4, Nakuru Industrial Park',
    currency: 'KES',
    subtotal: 50000.00,
    totalVat: 8000.00,
    totalDiscount: 0,
    grandTotal: 58000.00,
    lineItems: [
      {
        id: 'li_401',
        itemCode: 'LEG-FREIGHT-DIST',
        description: 'Freight Return Adjustment - Damaged Crate Reversal',
        quantity: 1,
        unitPrice: 50000.00,
        discountAmount: 0,
        taxableAmount: 50000.00,
        vatRate: 16,
        vatAmount: 8000.00,
        totalAmount: 58000.00,
        hsOrServiceCode: 'SRV-8703.20',
        codeType: 'SERVICE_CODE'
      }
    ],
    irn: 'IRN-CN-KE-2026-440192',
    qrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-CN-KE-2026-440192',
    verificationLink: 'https://nrs.portal.gov/verify?irn=IRN-CN-KE-2026-440192',
    nrsStampTimestamp: '2026-07-27 08:15:35',
    status: 'APPROVED',
    paymentStatus: 'UNPAID',
    ledgerWritebackStatus: 'SYNCED',
    createdAt: '2026-07-27 08:14:00',
    updatedAt: '2026-07-27 08:15:35'
  },
  {
    id: 'inv_1005',
    tenantId: 'tenant_csv_drop',
    clientInvoiceNumber: 'CSV-DROP-0044',
    invoiceType: 'STANDARD',
    invoiceKind: 'B2B',
    issueDate: '2026-07-27',
    dueDate: '2026-08-15',
    customerCode: 'CUST-METRO-401',
    customerName: 'Sunrise Supermarkets Ltd',
    customerTin: 'P099001122G',
    currency: 'KES',
    subtotal: 80000.00,
    totalVat: 12800.00,
    totalDiscount: 0,
    grandTotal: 92800.00,
    lineItems: [
      {
        id: 'li_501',
        itemCode: 'RAW-PLASTIC-PALLET',
        description: 'Heavy Duty Plastic Export Pallet Grade A',
        quantity: 40,
        unitPrice: 2000.00,
        discountAmount: 0,
        taxableAmount: 80000.00,
        vatRate: 16,
        vatAmount: 12800.00,
        totalAmount: 92800.00,
        hsOrServiceCode: 'UNMAPPED',
        codeType: 'UNMAPPED'
      }
    ],
    status: 'REJECTED',
    paymentStatus: 'UNPAID',
    ledgerWritebackStatus: 'FAILED',
    errorMessage: 'Mandatory hsOrServiceCode missing for line item RAW-PLASTIC-PALLET. Assign valid HS Code in Item Dictionary.',
    createdAt: '2026-07-27 08:00:00',
    updatedAt: '2026-07-27 08:00:05'
  }
];

export const INITIAL_VALIDATION_ERRORS: ValidationErrorItem[] = [
  {
    id: 'err_001',
    tenantId: 'tenant_csv_drop',
    clientInvoiceNumber: 'CSV-DROP-0044',
    errorCategory: 'MISSING_HS_CODE',
    fieldAffected: 'lineItems[0].hsOrServiceCode',
    errorMessage: 'Item SKU "RAW-PLASTIC-PALLET" has no registered HS Code or Service Code mapping in CittaEFS Dictionary.',
    rawPayloadSample: {
      clientInvoiceNumber: 'CSV-DROP-0044',
      itemCode: 'RAW-PLASTIC-PALLET',
      description: 'Heavy Duty Plastic Export Pallet Grade A',
      quantity: 40,
      unitPrice: 2000
    },
    status: 'OPEN',
    createdAt: '2026-07-27 08:00:05'
  },
  {
    id: 'err_002',
    tenantId: 'tenant_sql_legacy',
    clientInvoiceNumber: 'SQL-LEG-4033',
    errorCategory: 'INVALID_TIN_FORMAT',
    fieldAffected: 'customerTin',
    errorMessage: 'Customer TIN "1234567-X" does not comply with NRS Regex standard (Must start with P and end with letter).',
    rawPayloadSample: {
      clientInvoiceNumber: 'SQL-LEG-4033',
      customerName: 'Kiprotich Wholesalers',
      customerTin: '1234567-X'
    },
    status: 'OPEN',
    createdAt: '2026-07-27 08:12:10'
  }
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'audit_001',
    tenantId: 'tenant_qbo_smb',
    action: 'CITTA_SUBMITTED',
    entityType: 'INVOICE',
    entityRef: 'INV-2026-0089',
    details: 'Dispatched compliant POST payload to /api/integration/gen/invoices for Zenith Logistics Ltd. IRN assigned: IRN-KE-2026-09882190-QBO.',
    sha256PayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    performedBy: 'Bridge Managed Engine (v2.4)',
    timestamp: '2026-07-27 09:42:15'
  },
  {
    id: 'audit_002',
    tenantId: 'tenant_sap_ent',
    action: 'WEBHOOK_RECEIVED',
    entityType: 'INVOICE',
    entityRef: 'SAP-9002100',
    details: 'Received webhook event invoice.signed. Digital signature & QR Code verification link persisted. Ledger writeback status set to SYNCED.',
    sha256PayloadHash: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    performedBy: 'CittaEFS Gateway Listener',
    timestamp: '2026-07-27 10:01:10'
  },
  {
    id: 'audit_003',
    tenantId: 'tenant_csv_drop',
    action: 'INVOICE_INGESTED',
    entityType: 'INVOICE',
    entityRef: 'CSV-DROP-0044',
    details: 'SheetJS Excel Parser ingested file "batch_july27_metro.xlsx". Validation check failed: 1 unmapped SKU detected.',
    sha256PayloadHash: '1337c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    performedBy: 'SheetJS Drop Processor',
    timestamp: '2026-07-27 08:00:00'
  }
];

export const INITIAL_METRICS: SystemMetrics = {
  totalInvoicesProcessed: 15804,
  nrsStampSuccessRate: 99.85,
  averageLatencyMs: 142,
  activeTenantsCount: 4,
  pendingValidationCount: 2,
  reconciliationCronStatus: 'HEALTHY',
  cittaGatewayStatus: 'ONLINE'
};
