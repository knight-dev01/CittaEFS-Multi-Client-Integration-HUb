import { describe, it, expect } from 'vitest';
import { findQboStampFields, qrFieldValue, qboErrorStatus, QBO_STATUS, QBO_CUSTOM_FIELD_MAX } from '../../lib/qboCustomFields';

const prefs = (labels: Record<string, string>, off: string[] = []) => ({
  SalesFormsPrefs: {
    CustomField: [
      { CustomField: Object.keys(labels).map(n => ({ Name: `SalesFormsPrefs.UseSalesCustomName${n}`, Type: 'BooleanType', BooleanValue: !off.includes(n) })) },
      { CustomField: Object.entries(labels).map(([n, v]) => ({ Name: `SalesFormsPrefs.SalesCustomName${n}`, Type: 'StringType', StringValue: v })) },
    ],
  },
});

describe('QBO IRN / QR custom fields', () => {
  it('finds the fields by name from the invoice, in any order', () => {
    const fields = findQboStampFields(
      [{ DefinitionId: '1', Name: 'Crew #' }, { DefinitionId: '2', Name: 'QR Code' }, { DefinitionId: '3', Name: 'IRN' }],
      null,
    );
    expect(fields).toEqual({ irn: '3', qr: '2' });
  });

  it('reads names from company preferences and skips switched-off fields', () => {
    expect(findQboStampFields([], prefs({ '1': 'PO number', '2': 'NRS IRN', '3': 'QR_CODE_URL' }))).toEqual({ irn: '2', qr: '3' });
    expect(findQboStampFields([], prefs({ '1': 'IRN', '2': 'QR' }, ['1']))).toEqual({ irn: undefined, qr: '2' });
  });

  it('does not write anywhere when no field is named IRN or QR', () => {
    expect(findQboStampFields([{ DefinitionId: '1', Name: 'Crew #' }], prefs({ '1': 'Crew #' }))).toEqual({ irn: undefined, qr: undefined });
  });

  it('does not match words that merely contain the letters', () => {
    expect(findQboStampFields([{ DefinitionId: '1', Name: 'Firnance ref' }], null).irn).toBeUndefined();
  });

  it('puts a short link or an attachment pointer in the QR field', () => {
    expect(qrFieldValue('https://qr.ng/a1')).toBe('https://qr.ng/a1');
    expect(qrFieldValue('data:image/png;base64,AAAA')).toBe('See QR attachment');
    expect(qrFieldValue('https://example.com/a/very/long/verification/path/123')).toBe('See QR attachment');
  });

  it('finds a Status or Info field and never reuses the IRN/QR fields for it', () => {
    expect(findQboStampFields([{ DefinitionId: '1', Name: 'info' }, { DefinitionId: '2', Name: 'IRN' }], null))
      .toEqual({ irn: '2', qr: undefined, status: '1' });
    expect(findQboStampFields([], prefs({ '1': 'QR', '2': 'E-invoice status' }))).toMatchObject({ qr: '1', status: '2' });
    expect(findQboStampFields([{ DefinitionId: '1', Name: 'Information desk' }], null).status).toBeUndefined();
  });

  it('labels errors briefly, within the QuickBooks field limit', () => {
    expect(qboErrorStatus('Missing or invalid HS / service code for item "Gardening"')).toBe('Error: HS/service code');
    expect(qboErrorStatus('Invalid customer TIN "123"')).toBe('Error: customer TIN');
    expect(qboErrorStatus('Invoice type 380 must reference the original invoice\'s IRN')).toBe('Error: needs original IRN');
    expect(qboErrorStatus('Invoice number already exists in CittaEFS')).toBe('Error: duplicate invoice');
    expect(qboErrorStatus('This month the gateway was unreachable')).toBe('Error - see memo');
    for (const v of [...Object.values(QBO_STATUS), qboErrorStatus('customer not registered in CittaEFS')]) {
      expect(v.length).toBeLessThanOrEqual(QBO_CUSTOM_FIELD_MAX);
    }
  });
});
