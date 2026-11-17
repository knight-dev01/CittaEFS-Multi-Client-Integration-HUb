import { describe, it, expect } from 'vitest';
import { buildDigestEmail, parseRecipientList, type DigestError } from '../../lib/errorDigestFormat';

const tenant = { id: 't1', companyName: 'Acme Nigeria Ltd' };
const at = new Date('2026-11-12T10:00:00Z');

function err(partial: Partial<DigestError>): DigestError {
  return {
    id: Math.random().toString(36).slice(2),
    clientInvoiceNumber: 'INV-1001',
    errorCategory: 'MISSING_HS_CODE',
    fieldAffected: 'hsOrServiceCode',
    errorMessage: 'Invalid Product Code',
    sourceErp: 'qbo',
    createdAt: at,
    ...partial,
  };
}

describe('error digest email', () => {
  it('groups issues by category with an action and counts invoices', () => {
    const mail = buildDigestEmail(tenant, [
      err({ clientInvoiceNumber: 'INV-1001' }),
      err({ clientInvoiceNumber: 'INV-1002' }),
      err({ clientInvoiceNumber: 'INV/2026/00012', errorCategory: 'INVALID_TIN_FORMAT', fieldAffected: 'customerTin', sourceErp: 'odoo' }),
    ], 'https://hub.example.com');

    expect(mail.subject).toContain('3 invoice issues');
    expect(mail.subject).toContain('Acme Nigeria Ltd');
    expect(mail.text).toContain('Missing or invalid HS / service code (2)');
    expect(mail.text).toContain('Invalid customer TIN (1)');
    expect(mail.text).toContain('INV/2026/00012 [Odoo]');
    expect(mail.text).toContain('INV-1001 [QuickBooks Online]');
    expect(mail.html).toContain('<b>3</b> invoices');
    expect(mail.html).toContain('href="https://hub.example.com"');
  });

  it('escapes ERP-supplied text in the HTML body', () => {
    const mail = buildDigestEmail(tenant, [err({ errorMessage: '<script>alert(1)</script>', clientInvoiceNumber: '"><img src=x>' })]);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('mentions issues left out of a long email', () => {
    const mail = buildDigestEmail(tenant, [err({})], undefined, 5);
    expect(mail.subject).toContain('6 invoice issues');
    expect(mail.text).toContain('and 5 more issue(s)');
  });

  it('parses comma/semicolon separated recipients and drops invalid ones', () => {
    expect(parseRecipientList('a@x.com, B@Y.com; a@x.com  not-an-email')).toEqual(['a@x.com', 'b@y.com']);
    expect(parseRecipientList('')).toEqual([]);
    expect(parseRecipientList(null)).toEqual([]);
  });
});
