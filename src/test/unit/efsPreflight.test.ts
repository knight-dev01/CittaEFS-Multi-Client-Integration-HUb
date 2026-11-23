import { describe, it, expect } from 'vitest';
import { preflightInvoice, toEfsDate, toNumber, type EfsCatalog } from '../../lib/efsPreflight';
import { findRememberedCode, normalizeDescription } from '../../lib/codeMemory';
import { retrieveCandidates, CodeIndex } from '../../lib/codeRetrieval';

const today = new Date('2026-11-23T12:00:00Z');

const base = (): Record<string, any> => ({
  clientInvoiceNumber: 'INV-1001',
  issueDate: '23/11/2026',
  invoiceType: 'STANDARD',
  customerCode: ' CUST001 ',
  currency: '₦',
  lineItems: [
    { itemCode: 'LPT-1', description: 'Laptop  Pro\n15"', quantity: '2', unitPrice: '1,500,000.00', discountAmount: 100000, vatRate: 7.5, taxableAmount: 2900000, vatAmount: 217500.4, hsOrServiceCode: '8471.30' },
  ],
});

describe('toEfsDate', () => {
  it('reads common ERP formats day-first and rejects impossible dates', () => {
    expect(toEfsDate('2026-07-28')).toBe('2026-07-28');
    expect(toEfsDate('2026-07-28T10:30:00Z')).toBe('2026-07-28');
    expect(toEfsDate('28/07/2026')).toBe('2026-07-28');
    expect(toEfsDate('07/28/2026')).toBe('2026-07-28'); // second part cannot be a month
    expect(toEfsDate('28 Jul 2026')).toBe('2026-07-28');
    expect(toEfsDate('July 28, 2026')).toBe('2026-07-28');
    expect(toEfsDate('31/02/2026')).toBeNull();
    expect(toEfsDate('soon')).toBeNull();
  });
});

describe('toNumber', () => {
  it('parses ERP money strings', () => {
    expect(toNumber('1,250.50')).toBe(1250.5);
    expect(toNumber('₦5,000')).toBe(5000);
    expect(toNumber('abc')).toBeNull();
    expect(toNumber('')).toBeNull();
  });
});

describe('preflightInvoice', () => {
  it('normalises a messy but valid invoice to the CittaEFS format', () => {
    const { data, fixes, issues } = preflightInvoice(base(), { today });
    expect(issues).toEqual([]);
    expect(data.issueDate).toBe('2026-11-23');
    expect(data.currency).toBe('NGN');
    expect(data.invoiceTypeCode).toBe('381');
    expect(data.documentNumber).toBe('INV-1001');
    expect(data.customerCode).toBe('CUST001');
    const line = data.lineItems[0];
    expect(line.quantity).toBe(2);
    expect(line.unitPrice).toBe(1500000);
    expect(line.taxableAmount).toBe(2900000);
    expect(line.vatAmount).toBe(217500); // rounding aligned to taxable x rate
    expect(line.description).toBe('Laptop Pro 15"');
    expect(line.unitCode).toBe('EA');
    expect(line.taxCategoryId).toBe('STANDARD_VAT');
    expect(line.lineNum).toBe('1');
    expect(fixes.map(f => f.field)).toContain('invoiceNumber');
  });

  it('holds invoices CittaEFS would reject, with specific reasons', () => {
    const bad: any = base();
    bad.invoiceType = 'CREDIT_NOTE'; // 380 needs a billing reference
    bad.issueDate = '2026-12-25';
    bad.lineItems[0].unitPrice = 0;
    const { issues } = preflightInvoice(bad, { today });
    const fields = issues.map(i => i.field);
    expect(fields).toContain('billingReferenceIrns');
    expect(fields).toContain('issueDate');
    expect(fields).toContain('line 1.unitPrice');
  });

  it('flags a real tax mismatch instead of silently changing it', () => {
    const bad: any = base();
    bad.lineItems[0].vatAmount = 225000;
    const { issues } = preflightInvoice(bad, { today });
    expect(issues[0]).toMatchObject({ category: 'TAX_MISMATCH', field: 'line 1.taxAmount' });
  });

  it('checks codes against CittaEFS configured lists when available', () => {
    const catalog: EfsCatalog = {
      invoiceTypes: new Set(['381']),
      taxCategories: new Map([['STANDARD_VAT', 7.5]]),
      codes: new Set(['8471.41']),
    };
    const { issues } = preflightInvoice(base(), { today, catalog });
    expect(issues.map(i => i.field)).toEqual(['line 1.hsOrServiceCode']);
  });

  it('requires a real TIN for self-billed invoices', () => {
    const bad: any = { ...base(), invoiceTypeCode: '385', customerTin: '00000-000' };
    const { issues } = preflightInvoice(bad, { today });
    expect(issues.map(i => i.field)).toContain('customerTin');
  });
});

describe('code memory', () => {
  const items = [
    { clientSku: 'A1', description: 'Dell Latitude 5440 Laptop', hsOrServiceCode: '8471.30' },
    { clientSku: 'B2', description: 'Office chair', hsOrServiceCode: '9401.31' },
    { clientSku: 'B3', description: 'office chair', hsOrServiceCode: '9401.71' },
  ];
  it('reuses a confirmed code by SKU, then by identical wording', () => {
    expect(findRememberedCode(items, 'A1', 'x')).toEqual({ code: '8471.30', via: 'SKU' });
    expect(findRememberedCode(items, 'NEW', 'DELL LATITUDE 5440 laptop')).toEqual({ code: '8471.30', via: 'DESCRIPTION' });
  });
  it('refuses when confirmed codes disagree or the wording is vague', () => {
    expect(findRememberedCode(items, 'NEW', 'Office Chair')).toBeNull();
    expect(findRememberedCode([{ clientSku: 'S', description: 'Service', hsOrServiceCode: '8130' }], 'NEW', 'service')).toBeNull();
  });
  it('normalises Odoo references, numbers and punctuation', () => {
    expect(normalizeDescription('[LPT-01] Laptop, 16GB (x2) 2026')).toBe('laptop 16gb x2');
  });
});

describe('retrieveCandidates', () => {
  const index = new CodeIndex([
    { code: '8471.30', name: 'Portable automatic data processing machines, weighing not more than 10 kg', type: 'HS_CODE' },
    { code: '9401.31', name: 'Swivel seats with variable height adjustment, of wood', type: 'HS_CODE' },
    { code: '7020', name: 'Management consultancy activities', type: 'SERVICE_CODE' },
  ]);
  it('maps everyday wording onto catalog wording', () => {
    expect(retrieveCandidates('HP laptop 14 inch', [], 3, index)[0].code).toBe('8471.30');
    expect(retrieveCandidates('Consulting fees Q3', [], 3, index)[0].code).toBe('7020');
  });
  it('boosts codes the team confirmed for similar items', () => {
    const learned = [{ description: 'ergonomic office chair black', code: '9401.31' }];
    const top = retrieveCandidates('black ergonomic chair', learned, 3, index)[0];
    expect(top.code).toBe('9401.31');
    expect(top.learnedMatches).toBe(1);
  });
});
