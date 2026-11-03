import { describe, it, expect } from 'vitest';
import {
  describeGatewayFailure,
  formatGatewayErrorMessage,
  splitGatewayErrorMessage,
  TECHNICAL_DETAIL_MARKER,
} from '../../lib/gatewayErrors';

const REP_PTR_ERROR =
  'CittaEFS Gateway error (400): {"success":false,"message":"The INSERT statement conflicted with the CHECK constraint \\"CK_WM_001_INV_REP_PTR_Type\\". The conflict occurred in database \\"EFS\\", table \\"dbo.WM_001_INV_REP_PTR\\", column \'Type\'.\\r\\nThe statement has been terminated."}';

describe('describeGatewayFailure', () => {
  it('explains the WM_001_INV_REP_PTR constraint without repeating the SQL', () => {
    const { summary, technical } = describeGatewayFailure(REP_PTR_ERROR, {
      invoiceType: 'STANDARD',
      invoiceTypeCode: '381',
    });

    expect(summary).toContain('CK_WM_001_INV_REP_PTR_Type');
    expect(summary).toContain('invoiceTypeCode 381');
    expect(summary).toContain('retrying');
    expect(summary).not.toContain('INSERT statement');
    expect(technical).toContain('CK_WM_001_INV_REP_PTR_Type');
  });

  it('translates legacy rows that already carry the retry prefix', () => {
    const legacy = `CittaEFS gateway rejected after 5 retries: ${REP_PTR_ERROR}`;
    const { summary } = describeGatewayFailure(legacy);
    expect(summary).toContain('CK_WM_001_INV_REP_PTR_Type');
    expect(summary).not.toContain('rejected after 5 retries');
  });

  it('recognises a duplicate invoice number', () => {
    const { summary } = describeGatewayFailure(
      'CittaEFS Gateway error (400): {"success":false,"message":"Invoice Number already posted"}',
    );
    expect(summary.toLowerCase()).toContain('unique');
    expect(summary.toLowerCase()).toContain('archive');
  });

  it('recognises an authentication failure', () => {
    const { summary } = describeGatewayFailure(
      'CittaEFS Gateway error (401): {"message":"Unauthorized"}',
    );
    expect(summary).toContain('HTTP 401');
    expect(summary).toContain('CITTAEFS_API_KEY');
  });

  it('describes an unknown SQL constraint generically', () => {
    const { summary } = describeGatewayFailure(
      'CittaEFS Gateway error (400): The INSERT statement conflicted with the CHECK constraint "CK_OTHER". The conflict occurred in database "EFS", table "dbo.OTHER_TABLE", column \'Status\'.',
    );
    expect(summary).toContain('CK_OTHER');
    expect(summary).toContain('OTHER_TABLE');
    expect(summary).toContain('Status');
  });

  it('leaves a non-gateway message alone', () => {
    const message = 'Invalid Product Code: line 1 has no HS mapping.';
    expect(describeGatewayFailure(message)).toEqual({ summary: message, technical: null });
  });
});

describe('formatGatewayErrorMessage', () => {
  it('round-trips through splitGatewayErrorMessage', () => {
    const stored = formatGatewayErrorMessage(REP_PTR_ERROR, { invoiceTypeCode: '381' });
    expect(stored).toContain(TECHNICAL_DETAIL_MARKER);

    const { summary, technical } = splitGatewayErrorMessage(stored);
    expect(summary).toContain('CK_WM_001_INV_REP_PTR_Type');
    expect(technical).toBe(REP_PTR_ERROR);
  });

  it('splits a stored message that has no technical detail', () => {
    expect(splitGatewayErrorMessage('Already resolved.')).toEqual({
      summary: 'Already resolved.',
      technical: null,
    });
  });
});
