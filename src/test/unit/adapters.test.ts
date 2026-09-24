import { describe, it, expect } from 'vitest';
import { QuickBooksAdapter, OdooAdapter } from '../../adapters/connectorAdapters';

describe('ConnectorAdapters — ERP normalize (gateway)', () => {
  it('QBO Gardening → 8130 bare (not HS-8471.30)', () => {
    const a = new QuickBooksAdapter();
    const payload = a.transform({
      DocNumber: 'INV1', Id: '1', TxnDate: '2026-09-10',
      CustomerRef: { name: 'Client', value: '20' }, CustomerTaxId: '1234567890',
      Line: [{ DetailType: 'SalesItemLineDetail', Description: 'Gardening', SalesItemLineDetail: { ItemRef: { name: 'Gardening' }, Qty: 1, UnitPrice: 10 } }],
    });
    expect(payload.lineItems[0].hsOrServiceCode).toBe('8130');
  });

  it('QBO Pest Control → 8130', () => {
    const a = new QuickBooksAdapter();
    const p = a.transform({
      DocNumber: 'INV2', Id: '2', TxnDate: '2026-09-10',
      CustomerRef: { name: 'C', value: '20' }, CustomerTaxId: '123',
      Line: [{ DetailType: 'SalesItemLineDetail', Description: 'Pest Control Services', SalesItemLineDetail: { ItemRef: { name: 'Pest Control' }, Qty: 2, UnitPrice: 35 } }],
    });
    expect(p.lineItems[0].hsOrServiceCode).toBe('8130');
  });

  it('Odoo Trimming → 8130', () => {
    const a = new OdooAdapter();
    const p = a.transform({
      name: 'INV/2024/1', id: 1, invoice_date: '2026-09-10', partner_id: [5, 'Client'], _partnerVat: '1234567890',
      currency_id: [1, 'NGN'], move_type: 'out_invoice',
      _lines: [{ product_id: [1, '[SKU] Trimming'], name: 'Tree and Shrub Trimming', quantity: 1, price_unit: 15, price_subtotal: 15, price_total: 16.125 }],
    });
    expect(p.lineItems[0].hsOrServiceCode).toBe('8130');
  });

  it('QBO Laptop → 8471.30 bare', () => {
    const a = new QuickBooksAdapter();
    const p = a.transform({
      DocNumber: 'INV3', Id: '3', TxnDate: '2026-09-10',
      CustomerRef: { name: 'C', value: '20' }, CustomerTaxId: '123',
      Line: [{ DetailType: 'SalesItemLineDetail', Description: 'Laptop', SalesItemLineDetail: { ItemRef: { name: 'Laptop' }, Qty: 1, UnitPrice: 1000 } }],
    });
    expect(p.lineItems[0].hsOrServiceCode).toBe('8471.30');
  });
});
