import { describe, it, expect } from 'vitest';
import { invoiceIngestionSchema } from '../../schemas/invoice.schema';

describe('invoiceIngestionSchema — ERP-sourced gateway', () => {
  const base = {
    tenantId: 'tenant_qbo_smb',
    clientInvoiceNumber: 'INV123',
    issueDate: '2026-09-10',
    customerName: 'Acme',
    customerCode: 'CUST20',
    customerTin: '12345678901234',
    sourceErp: 'qbo',
    lineItems: [{ itemCode: 'SKU1', description: 'Gardening', quantity: 1, unitPrice: 100, hsOrServiceCode: '8130', vatRate: 7.5 }],
  };

  it('accepts qbo-sourced invoice with bare 8130', () => {
    expect(() => invoiceIngestionSchema.parse(base)).not.toThrow();
  });

  it('B2B without TIN downgrades to B2C and strips tin', () => {
    const parsed: any = invoiceIngestionSchema.parse({ ...base, customerTin: '' });
    expect(parsed.invoiceKind).toBe('B2C');
    expect(parsed.customerTin).toBeUndefined();
  });

  it('rejects invoice number with dash (^[A-Z0-9]+$)', () => {
    expect(() => invoiceIngestionSchema.parse({ ...base, clientInvoiceNumber: 'INV-123' })).toThrow();
  });

  it('computes taxable/vat/total with headerDiscount', () => {
    const parsed: any = invoiceIngestionSchema.parse({ ...base, headerDiscount: 10 });
    expect(parsed.subtotal).toBeDefined();
    expect(parsed.grandTotal).toBeLessThan(parsed.subtotal + parsed.totalVat + 0.01);
  });

  it('defaults sourceErp qbo/odoo allowed, Excel would be rejected at route layer (schema allows but route 403)', () => {
    const parsed: any = invoiceIngestionSchema.parse({ ...base, sourceErp: 'excel' as any });
    expect(parsed.sourceErp).toBe('excel');
  });
});
