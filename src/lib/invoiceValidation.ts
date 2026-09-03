/**
 * Shared invoice row validation — used by ExcelDocumentViewer and QBO ingest.
 * Single source of truth for HS/TIN/Qty etc. so QBO and Excel stay normalised to CittaEFS.
 */
export interface RowLike {
  clientInvoiceNumber: string;
  documentNumber?: string;
  issueDate: string;
  customerCode: string;
  customerName: string;
  customerTin: string;
  invoiceKind: string;
  invoiceTypeCode?: string;
  itemCode: string;
  hsOrServiceCode: string;
  quantity: any;
  unitPrice: any;
  vatRate: any;
  headerCharges?: number;
  headerDiscount?: number;
  billingReferenceIrns?: string;
  currency?: string;
}

export function getRowErrors(row: RowLike): string[] {
  const errs: string[] = [];
  if (!row.clientInvoiceNumber || String(row.clientInvoiceNumber).trim().length < 3) errs.push('Invoice # missing/short');
  if (!row.issueDate || isNaN(Date.parse(row.issueDate))) errs.push('Issue Date invalid');
  if (!row.customerCode || String(row.customerCode).trim().length < 2) errs.push('Customer Code missing');
  if (!row.customerName || String(row.customerName).trim().length < 2) errs.push('Customer Name missing');
  if ((row.invoiceKind === 'B2B' || row.invoiceKind === 'B2G') && (!row.customerTin || !/^[A-Za-z0-9]{10,14}$/.test(String(row.customerTin).trim()))) errs.push('B2B TIN 10-14 alphanum required');
  if (!row.itemCode || String(row.itemCode).trim().length < 2) errs.push('SKU missing');
  if (!row.hsOrServiceCode || row.hsOrServiceCode === 'UNMAPPED' || row.hsOrServiceCode === 'SERV-DEFAULT') errs.push('HS code missing');
  if (!row.quantity || Number(row.quantity) <= 0) errs.push('Qty >0 required');
  if (row.unitPrice === undefined || Number(row.unitPrice) < 0) errs.push('Price required');
  if (row.vatRate === undefined || Number(row.vatRate) < 0 || Number(row.vatRate) > 100) errs.push('VAT 0-100 required');
  // Gold: InvoiceTypeCode requiring BillingReferenceIRNs for 380/381/384/393
  const codeRequiringIRN = ['380','381','384','385','393'];
  if (row.invoiceTypeCode && codeRequiringIRN.includes(String(row.invoiceTypeCode).trim()) && (!row.billingReferenceIrns || String(row.billingReferenceIrns).trim().length < 5)) {
    errs.push(`InvoiceTypeCode ${row.invoiceTypeCode} requires Billing Reference IRN(s)`);
  }
  if (row.headerCharges !== undefined && Number(row.headerCharges) < 0) errs.push('HeaderCharges cannot be negative');
  if (row.headerDiscount !== undefined && Number(row.headerDiscount) < 0) errs.push('HeaderDiscount cannot be negative');
  return errs;
}

export function normalizeHsCode(sku: string, existingHs?: string): string {
  if (existingHs && existingHs !== 'UNMAPPED' && existingHs !== 'SERV-DEFAULT' && existingHs.trim()) return existingHs.trim();
  const isService = (sku || '').toUpperCase().startsWith('SRV');
  return isService ? 'SRV-7212.10' : 'HS-8471.30';
}
