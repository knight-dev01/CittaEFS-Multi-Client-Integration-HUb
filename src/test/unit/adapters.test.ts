import { describe, it, expect } from 'vitest';
import { QuickBooksAdapter, OdooAdapter } from '../../adapters/connectorAdapters';
import { normalizeHsCode } from '../../lib/invoiceValidation';

// Tax classification must come from the operator's Item mapping or a code the
// ERP actually sent. Guessing from descriptions is a compliance error, so an
// unclassified line stays UNMAPPED and is routed to the validation queue.
describe('ConnectorAdapters — no HS/service code guessing', () => {
  it('QBO line described "Gardening" is NOT auto-classified', () => {
    const p = new QuickBooksAdapter().transform({
      DocNumber: 'INV1', Id: '1', TxnDate: '2026-09-10',
      CustomerRef: { name: 'Client', value: '20' }, CustomerTaxId: '1234567890',
      Line: [{ DetailType: 'SalesItemLineDetail', Description: 'Gardening', SalesItemLineDetail: { ItemRef: { name: 'Gardening' }, Qty: 1, UnitPrice: 10 } }],
    });
    expect(p.lineItems[0].hsOrServiceCode).toBe('UNMAPPED');
  });

  it('QBO line described "Laptop" is NOT auto-classified', () => {
    const p = new QuickBooksAdapter().transform({
      DocNumber: 'INV3', Id: '3', TxnDate: '2026-09-10',
      CustomerRef: { name: 'C', value: '20' }, CustomerTaxId: '123',
      Line: [{ DetailType: 'SalesItemLineDetail', Description: 'Laptop', SalesItemLineDetail: { ItemRef: { name: 'Laptop' }, Qty: 1, UnitPrice: 1000 } }],
    });
    expect(p.lineItems[0].hsOrServiceCode).toBe('UNMAPPED');
  });

  it('QBO keeps a code the ERP explicitly sent', () => {
    const p = new QuickBooksAdapter().transform({
      DocNumber: 'INV4', Id: '4', TxnDate: '2026-09-10',
      CustomerRef: { name: 'C', value: '20' },
      lineItems: [{ clientSku: 'LAP-01', description: 'Laptop', quantity: 1, unitPrice: 1000, hsOrServiceCode: '8471.30' }],
    });
    expect(p.lineItems[0].hsOrServiceCode).toBe('8471.30');
  });

  it('Odoo line described "Trimming" is NOT auto-classified', () => {
    const p = new OdooAdapter().transform({
      name: 'INV/2024/1', id: 1, invoice_date: '2026-09-10', partner_id: [5, 'Client'], _partnerVat: '1234567890',
      currency_id: [1, 'NGN'], move_type: 'out_invoice',
      _lines: [{ product_id: [1, '[SKU] Trimming'], name: 'Tree and Shrub Trimming', quantity: 1, price_unit: 15, price_subtotal: 15, price_total: 16.125 }],
    });
    expect(p.lineItems[0].hsOrServiceCode).toBe('UNMAPPED');
  });

  it('normalizeHsCode does not guess from an SRV SKU prefix', () => {
    expect(normalizeHsCode('SRV-CONSULT')).toBe('UNMAPPED');
    expect(normalizeHsCode('SRV-CONSULT', '6209')).toBe('6209');
  });
});
