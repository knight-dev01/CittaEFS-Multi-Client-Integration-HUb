import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildEfsExport,
  efsInvoiceTypeCode,
  exportFileName,
  isEfsExportFormat,
  toCsv,
  toJson,
  toXlsx,
} from '../../lib/efsExport';
import { INVOICE_TEMPLATE_COLUMNS } from '../../data/invoiceTemplateReference';

const invoice = {
  id: 'inv-1',
  clientInvoiceNumber: 'INV2024001',
  documentNumber: 'PO-001',
  issueDate: new Date('2026-11-04T00:00:00.000Z'),
  customerCode: 'CUST1',
  invoiceType: 'STANDARD',
  currency: 'NGN',
  headerCharges: 0,
  headerDiscount: 0,
  lineItems: [
    { itemCode: 'SKU1', unitPrice: 100, quantity: 2, taxableAmount: 200, vatAmount: 15, discountAmount: 0 },
    { itemCode: 'SKU2', unitPrice: 50, quantity: 1, taxableAmount: 50, vatAmount: 3.75, discountAmount: 0 },
  ],
};

describe('EFS export', () => {
  it('accepts only the supported formats', () => {
    expect(isEfsExportFormat('csv')).toBe(true);
    expect(isEfsExportFormat('xlsx')).toBe(true);
    expect(isEfsExportFormat('json')).toBe(true);
    expect(isEfsExportFormat('pdf')).toBe(false);
  });

  it('maps invoice types to EFS codes and honours an explicit code', () => {
    expect(efsInvoiceTypeCode('STANDARD')).toBe('381');
    expect(efsInvoiceTypeCode('CREDIT_NOTE')).toBe('380');
    expect(efsInvoiceTypeCode('DEBIT_NOTE')).toBe('384');
    expect(efsInvoiceTypeCode('CREDIT_NOTE_REQUEST')).toBe('395');
    expect(efsInvoiceTypeCode('STANDARD', '388')).toBe('388');
    expect(efsInvoiceTypeCode('STANDARD', '31')).toBe('381');
  });

  it('writes one row per line with the exact template headers', () => {
    const result = buildEfsExport([invoice]);
    expect(result.columns).toEqual(INVOICE_TEMPLATE_COLUMNS.map((column) => column.header));
    expect(result.rows).toHaveLength(2);
    expect(result.invoicesExported).toBe(1);
    expect(result.rows[0]['Line Number']).toBe(1);
    expect(result.rows[1]['Line Number']).toBe(2);
    expect(result.rows[0]['Invoice Type']).toBe('381');
    expect(result.rows[0]['Issue Date']).toBe('2026-11-04');
    expect(result.rows[0]['Item Code']).toBe('SKU1');
    expect(typeof result.rows[0]['Taxable Amount']).toBe('number');
  });

  it('skips invoices with no line items instead of emitting invalid rows', () => {
    const result = buildEfsExport([invoice, { id: 'inv-2', clientInvoiceNumber: 'INV2', lineItems: [] }]);
    expect(result.rows).toHaveLength(2);
    expect(result.invoicesExported).toBe(1);
    expect(result.invoicesSkipped).toEqual(['INV2']);
  });

  it('produces CSV with a BOM, CRLF and quoted values where needed', () => {
    const result = buildEfsExport([invoice]);
    result.rows[0]['Customer Code'] = 'A,B';
    const csv = toCsv(result);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Document Number,Customer Code,Invoice Number');
    expect(csv).toContain('"A,B"');
    expect(csv.split('\r\n')[0]).toContain('Invoice Type');
  });

  it('produces an Excel workbook with one InvoiceTemplate sheet', () => {
    const buffer = toXlsx(buildEfsExport([invoice]));
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['InvoiceTemplate']);
    const sheet = workbook.Sheets.InvoiceTemplate;
    const rows = XLSX.utils.sheet_to_json<any>(sheet);
    expect(rows).toHaveLength(2);
    expect(rows[0]['Invoice Number']).toBe('INV2024001');
  });

  it('produces JSON with the same rows and a skip list', () => {
    const parsed = JSON.parse(toJson(buildEfsExport([invoice])));
    expect(parsed.format).toBe('cittaefs-efs-upload');
    expect(parsed.sheetName).toBe('InvoiceTemplate');
    expect(parsed.rowCount).toBe(2);
    expect(parsed.rows[0]['Item Code']).toBe('SKU1');
  });

  it('builds a safe, dated filename', () => {
    expect(exportFileName('csv', 'tenant one')).toMatch(/^cittaefs-efs-tenant_one-\d{8}\.csv$/);
    expect(exportFileName('xlsx', 'tenant-1')).toMatch(/^cittaefs-efs-tenant-1-\d{8}\.xlsx$/);
  });
});
