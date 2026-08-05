/**
 * EFS Normalization Engine
 * 
 * Transforms heterogeneous ERP data (QBO, Excel) into the standardized
 * EFS Template format before sending to CittaEFS Gateway.
 */

// ================================================
// NORMALIZED EFS INVOICE LINE SCHEMA
// ================================================

export interface NormalizedEFSInvoiceLine {
  // Required fields
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  customerCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  taxAmount: number;
  taxableAmount: number;
  hsOrServiceCode: string;
  lineNum: string;

  // Optional fields
  itemDescription?: string;
  unitCode?: string;          // Default "EA"
  taxCategoryId?: string;     // Default "1" (Standard VAT)
  currencyCode?: string;       // Default "KES"
  invoiceTypeCode?: string;    // Default "388" (Standard Invoice)
  headerDiscount?: number;
  headerCharges?: number;
  lineDiscount?: number;
  useStateTax?: boolean;

  // Reference fields
  documentNumber?: string;
  billingReferenceIrns?: string[];
  
  // Metadata
  metadata?: {
    sourceSystem: 'QUICKBOOKS_ONLINE' | 'EFS_TEMPLATE_EXCEL';
    userId?: string;
    branchCode?: string;
    originalInvoiceId?: string;
  };
}

export interface NormalizedEFSInvoice {
  invoiceNumber: string;
  issueDate: string;
  customerCode: string;
  customerName: string;
  customerTin?: string;
  invoiceKind: 'B2B' | 'B2C';
  invoiceType: 'STANDARD' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'CANCELLATION';
  currency: string;
  lineItems: NormalizedEFSInvoiceLine[];
  metadata?: {
    sourceSystem: 'QUICKBOOKS_ONLINE' | 'EFS_TEMPLATE_EXCEL';
    tenantId: string;
    originalInvoiceId?: string;
  };
}

// ================================================
// TAX CALCULATION RULES
// ================================================

/**
 * Calculate taxable amount: unitPrice × quantity - lineDiscount
 */
export function calculateTaxableAmount(
  unitPrice: number,
  quantity: number,
  lineDiscount: number = 0
): number {
  return Math.max(0, (unitPrice * quantity) - lineDiscount);
}

/**
 * Calculate VAT amount: taxableAmount × vatRate / 100
 */
export function calculateVatAmount(
  taxableAmount: number,
  vatRate: number
): number {
  return (taxableAmount * vatRate) / 100;
}

/**
 * Calculate total amount: taxableAmount + vatAmount
 */
export function calculateTotalAmount(
  taxableAmount: number,
  vatAmount: number
): number {
  return taxableAmount + vatAmount;
}

/**
 * Default VAT rate for Kenya (16%)
 */
export const DEFAULT_VAT_RATE = 16;

/**
 * Default currency for Kenya
 */
export const DEFAULT_CURRENCY = 'KES';

/**
 * Default invoice type code for standard invoices
 */
export const INVOICE_TYPE_CODE_STANDARD = '388';

/**
 * Default unit code for pieces
 */
export const UNIT_CODE_PIECES = 'EA';

// ================================================
// QBO NORMALIZATION
// ================================================

export interface QBOLineItem {
  Description?: string;
  Amount?: number;
  SalesItemLineDetail?: {
    ItemRef?: { value?: string; name?: string };
    Qty?: number;
    UnitPrice?: number;
    TaxCodeRef?: { value?: string };
  };
  DiscountAmt?: number;
}

export interface QBOInvoice {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  CustomerRef?: { value?: string; name?: string };
  CustomerTaxId?: string;
  CurrencyRef?: { value?: string };
  Line?: QBOLineItem[];
  GlobalTaxCalculation?: string;
}

/**
 * Normalize QuickBooks Online invoice to EFS format
 */
export function normalizeQBOInvoice(
  qboInvoice: QBOInvoice,
  options: {
    tenantId: string;
    defaultHsCode?: string;
    defaultVatRate?: number;
  }
): NormalizedEFSInvoice {
  const {
    tenantId,
    defaultHsCode = 'SERV-DEFAULT',
    defaultVatRate = DEFAULT_VAT_RATE
  } = options;

  const lineItems: NormalizedEFSInvoiceLine[] = (qboInvoice.Line || []).map((line, index) => {
    const quantity = line.SalesItemLineDetail?.Qty || 1;
    const unitPrice = line.SalesItemLineDetail?.UnitPrice || line.Amount || 0;
    const lineDiscount = line.DiscountAmt || 0;

    const taxableAmount = calculateTaxableAmount(unitPrice, quantity, lineDiscount);
    const vatAmount = calculateVatAmount(taxableAmount, defaultVatRate);

    return {
      invoiceNumber: qboInvoice.DocNumber || `QBO-${qboInvoice.Id || Date.now()}`,
      issueDate: qboInvoice.TxnDate || new Date().toISOString().substring(0, 10),
      customerCode: qboInvoice.CustomerRef?.value || 'QBO-CUST',
      itemName: line.SalesItemLineDetail?.ItemRef?.name || line.Description || `Item ${index + 1}`,
      itemDescription: line.Description,
      quantity,
      unitPrice,
      taxAmount: Number(vatAmount.toFixed(2)),
      taxableAmount: Number(taxableAmount.toFixed(2)),
      hsOrServiceCode: defaultHsCode,
      lineNum: String(index + 1),
      currencyCode: qboInvoice.CurrencyRef?.value || DEFAULT_CURRENCY,
      unitCode: UNIT_CODE_PIECES,
      taxCategoryId: '1',
      invoiceTypeCode: INVOICE_TYPE_CODE_STANDARD,
      lineDiscount: lineDiscount > 0 ? lineDiscount : undefined,
      metadata: {
        sourceSystem: 'QUICKBOOKS_ONLINE',
        tenantId,
        originalInvoiceId: qboInvoice.Id
      }
    };
  });

  // Determine B2B/B2C based on customer TIN
  const customerTin = qboInvoice.CustomerTaxId;
  const invoiceKind: 'B2B' | 'B2C' = customerTin && customerTin.trim() ? 'B2B' : 'B2C';

  return {
    invoiceNumber: qboInvoice.DocNumber || `QBO-${qboInvoice.Id || Date.now()}`,
    issueDate: qboInvoice.TxnDate || new Date().toISOString().substring(0, 10),
    customerCode: qboInvoice.CustomerRef?.value || 'QBO-CUST',
    customerName: qboInvoice.CustomerRef?.name || 'QBO Customer',
    customerTin: customerTin || undefined,
    invoiceKind,
    invoiceType: 'STANDARD',
    currency: qboInvoice.CurrencyRef?.value || DEFAULT_CURRENCY,
    lineItems,
    metadata: {
      sourceSystem: 'QUICKBOOKS_ONLINE',
      tenantId,
      originalInvoiceId: qboInvoice.Id
    }
  };
}

// ================================================
// EXCEL NORMALIZATION
// ================================================

export interface ExcelRawRow {
  clientInvoiceNumber?: string;
  invoiceNumber?: string;
  invoiceKind?: string;
  issueDate?: string;
  customerCode?: string;
  customerName?: string;
  customerTin?: string;
  itemCode?: string;
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  hsOrServiceCode?: string;
  vatRate?: number | string;
  discountAmount?: number | string;
  [key: string]: any;
}

/**
 * Normalize Excel/CSV row to EFS format
 */
export function normalizeExcelRow(
  row: ExcelRawRow,
  options: {
    tenantId: string;
    defaultVatRate?: number;
    defaultHsCode?: string;
  }
): NormalizedEFSInvoiceLine {
  const {
    tenantId,
    defaultVatRate = DEFAULT_VAT_RATE,
    defaultHsCode = 'SERV-DEFAULT'
  } = options;

  const invoiceNumber = row.clientInvoiceNumber || row.invoiceNumber || `EXCEL-${Date.now()}`;
  const issueDate = row.issueDate || new Date().toISOString().substring(0, 10);
  const customerCode = row.customerCode || 'EXCEL-CUST';
  const itemName = row.itemCode || row.description || `Item`;
  const itemDescription = row.description || undefined;
  
  const quantity = typeof row.quantity === 'string' ? parseFloat(row.quantity) : (row.quantity || 1);
  const unitPrice = typeof row.unitPrice === 'string' ? parseFloat(row.unitPrice) : (row.unitPrice || 0);
  const discountAmount = typeof row.discountAmount === 'string' 
    ? parseFloat(row.discountAmount) 
    : (row.discountAmount || 0);
  const vatRate = typeof row.vatRate === 'string' 
    ? parseFloat(row.vatRate) 
    : (row.vatRate || defaultVatRate);

  const taxableAmount = calculateTaxableAmount(unitPrice, quantity, discountAmount);
  const vatAmount = calculateVatAmount(taxableAmount, vatRate);

  return {
    invoiceNumber,
    issueDate,
    customerCode,
    itemName,
    itemDescription,
    quantity,
    unitPrice,
    taxAmount: Number(vatAmount.toFixed(2)),
    taxableAmount: Number(taxableAmount.toFixed(2)),
    hsOrServiceCode: row.hsOrServiceCode || defaultHsCode,
    lineNum: '1',
    currencyCode: DEFAULT_CURRENCY,
    unitCode: UNIT_CODE_PIECES,
    taxCategoryId: '1',
    invoiceTypeCode: INVOICE_TYPE_CODE_STANDARD,
    lineDiscount: discountAmount > 0 ? discountAmount : undefined,
    metadata: {
      sourceSystem: 'EFS_TEMPLATE_EXCEL',
      tenantId
    }
  };
}

/**
 * Group Excel rows by invoice number and create NormalizedEFSInvoice
 */
export function normalizeExcelRows(
  rows: ExcelRawRow[],
  options: {
    tenantId: string;
    defaultVatRate?: number;
    defaultHsCode?: string;
  }
): NormalizedEFSInvoice[] {
  // Group rows by invoice number
  const invoiceGroups = new Map<string, ExcelRawRow[]>();
  
  for (const row of rows) {
    const invoiceNumber = row.clientInvoiceNumber || row.invoiceNumber || `EXCEL-${Date.now()}`;
    if (!invoiceGroups.has(invoiceNumber)) {
      invoiceGroups.set(invoiceNumber, []);
    }
    invoiceGroups.get(invoiceNumber)!.push(row);
  }

  // Create normalized invoices
  const invoices: NormalizedEFSInvoice[] = [];
  
  for (const [invoiceNumber, groupRows] of invoiceGroups) {
    const firstRow = groupRows[0];
    
    // Normalize all line items
    const lineItems: NormalizedEFSInvoiceLine[] = groupRows.map((row, index) => {
      const normalized = normalizeExcelRow(row, options);
      normalized.lineNum = String(index + 1);
      return normalized;
    });

    // Determine B2B/B2C
    const customerTin = firstRow.customerTin;
    const invoiceKind: 'B2B' | 'B2C' = customerTin && customerTin.trim() && customerTin !== 'N/A' ? 'B2B' : 'B2C';

    invoices.push({
      invoiceNumber,
      issueDate: firstRow.issueDate || new Date().toISOString().substring(0, 10),
      customerCode: firstRow.customerCode || 'EXCEL-CUST',
      customerName: firstRow.customerName || 'Excel Customer',
      customerTin: invoiceKind === 'B2B' ? customerTin : undefined,
      invoiceKind,
      invoiceType: 'STANDARD',
      currency: DEFAULT_CURRENCY,
      lineItems,
      metadata: {
        sourceSystem: 'EFS_TEMPLATE_EXCEL',
        tenantId: options.tenantId
      }
    });
  }

  return invoices;
}

// ================================================
// VALIDATION HELPERS
// ================================================

/**
 * Validate EFS Invoice structure
 */
export function validateEFSInvoice(invoice: NormalizedEFSInvoice): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!invoice.invoiceNumber) {
    errors.push('Invoice number is required');
  }

  if (!invoice.issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate)) {
    errors.push('Issue date must be in YYYY-MM-DD format');
  }

  if (!invoice.customerCode) {
    errors.push('Customer code is required');
  }

  if (!invoice.customerName) {
    errors.push('Customer name is required');
  }

  if (invoice.invoiceKind === 'B2B' && !invoice.customerTin) {
    errors.push('B2B invoices require a customer TIN');
  }

  if (!invoice.lineItems || invoice.lineItems.length === 0) {
    errors.push('At least one line item is required');
  }

  // Validate each line item
  invoice.lineItems?.forEach((item, index) => {
    if (!item.itemName) {
      errors.push(`Line ${index + 1}: Item name is required`);
    }
    if (item.quantity <= 0) {
      errors.push(`Line ${index + 1}: Quantity must be positive`);
    }
    if (item.unitPrice < 0) {
      errors.push(`Line ${index + 1}: Unit price cannot be negative`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Convert NormalizedEFSInvoice to CittaEFS API format
 */
export function toCittaEfsPayload(invoice: NormalizedEFSInvoice): {
  tenantId: string;
  clientInvoiceNumber: string;
  invoiceType: 'STANDARD' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'CANCELLATION';
  invoiceKind: 'B2B' | 'B2C';
  customerName: string;
  customerTin?: string;
  lineItems: Array<{
    itemCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxableAmount: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    hsOrServiceCode: string;
  }>;
  issueDate: string;
} {
  return {
    tenantId: invoice.metadata?.tenantId || '',
    clientInvoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.invoiceType,
    invoiceKind: invoice.invoiceKind,
    customerName: invoice.customerName,
    customerTin: invoice.customerTin,
    lineItems: invoice.lineItems.map(item => ({
      itemCode: item.itemName,
      description: item.itemDescription || item.itemName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxableAmount: item.taxableAmount,
      vatRate: DEFAULT_VAT_RATE,
      vatAmount: item.taxAmount,
      totalAmount: item.taxableAmount + item.taxAmount,
      hsOrServiceCode: item.hsOrServiceCode
    })),
    issueDate: invoice.issueDate
  };
}
