import { describe, it, expect } from 'vitest';
import { buildInlineCustomer, toIso2Country, missingCustomerDetailsMessage } from '../../lib/inlineCustomer';
import { qboErrorStatus } from '../../lib/qboCustomFields';

const complete = {
  name: 'ABC Limited',
  tin: '12345678-0001',
  email: 'accounts@abclimited.com',
  street: '12 Main Street',
  city: 'Lagos',
  postalCode: '100001',
  country: 'Nigeria',
};

describe('toIso2Country', () => {
  it('accepts names and ISO codes', () => {
    expect(toIso2Country('Nigeria')).toBe('NG');
    expect(toIso2Country('ng')).toBe('NG');
    expect(toIso2Country('NGA')).toBe('NG');
    expect(toIso2Country('United Kingdom')).toBe('GB');
  });
  it('returns null for blanks, Odoo false and unknown names', () => {
    expect(toIso2Country('')).toBeNull();
    expect(toIso2Country(false)).toBeNull();
    expect(toIso2Country('Atlantis')).toBeNull();
  });
});

describe('buildInlineCustomer', () => {
  it('builds the CittaEFS inline customer when every detail is present', () => {
    expect(buildInlineCustomer(complete)).toEqual({
      customer: { ...complete, country: 'NG' },
      missing: [],
    });
  });

  it('lists what is missing instead of guessing, treating Odoo false as blank', () => {
    const { customer, missing } = buildInlineCustomer({ ...complete, email: false as any, postalCode: '', country: null });
    expect(customer).toBeNull();
    expect(missing).toEqual(['email address', 'postal code', 'country']);
  });

  it('says why an email or country was refused', () => {
    const { missing } = buildInlineCustomer({ ...complete, email: 'not-an-email', country: 'Atlantis' });
    expect(missing).toEqual(['a valid email address', 'a recognised country (got "Atlantis")']);
  });

  it('writes an ERP message that names the fields and maps to a short QBO label', () => {
    const message = missingCustomerDetailsMessage('ABC Limited', ['email address', 'postal code']);
    expect(message).toContain('email address, postal code');
    expect(qboErrorStatus(message)).toBe('Error: customer details');
  });
});
