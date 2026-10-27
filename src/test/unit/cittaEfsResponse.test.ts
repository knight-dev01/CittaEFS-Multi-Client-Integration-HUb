import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import {
  parseBulkSubmitResponse,
  buildBulkPaymentUpdateBody,
  cittaEfsClient,
} from '../../services/cittaEfsClient';

describe('parseBulkSubmitResponse', () => {
  it('extracts the inline IRN from the legacy response shape', () => {
    const parsed = parseBulkSubmitResponse({
      success: true,
      totalInvoices: 1,
      successCount: 1,
      failedCount: 0,
      errors: [],
      items: [{ irn: 'IRN-1', csid: 'CSID-1', qrCodeUrl: 'https://qr/1' }],
    });
    expect(parsed.irn).toBe('IRN-1');
    expect(parsed.csid).toBe('CSID-1');
    expect(parsed.qrCodeUrl).toBe('https://qr/1');
    expect(parsed.accepted).toBe(false);
  });

  it('accepts the current documented shape without an inline IRN', () => {
    const parsed = parseBulkSubmitResponse({
      success: true,
      totalInvoices: 1,
      validCount: 1,
      invalidCount: 0,
      validInvoices: ['INV2024001'],
      invalidInvoices: [],
      validDocumentNumbers: ['PO-001'],
      metadata: {},
      errors: [],
    });
    expect(parsed.irn).toBe('');
    expect(parsed.accepted).toBe(true);
    expect(parsed.validInvoices).toEqual(['INV2024001']);
    expect(parsed.invalidInvoices).toEqual([]);
  });

  it('rejects the current shape when no invoice passed validation', () => {
    expect(() =>
      parseBulkSubmitResponse({
        success: false,
        validCount: 0,
        invalidCount: 1,
        validInvoices: [],
        invalidInvoices: ['INV-BAD'],
        errors: [{ invoiceNumber: 'INV-BAD', field: 'TaxAmount', error: 'mismatch' }],
      }),
    ).toThrow(/rejected the invoice batch/i);
  });

  it('keeps legacy failure semantics', () => {
    expect(() =>
      parseBulkSubmitResponse({
        success: false,
        successCount: 0,
        failedCount: 1,
        errors: [{ field: 'HSorService' }],
      }),
    ).toThrow(/processing failed/i);
  });

  it('never fabricates an IRN for a legacy response missing the stamp', () => {
    expect(() =>
      parseBulkSubmitResponse({ success: true, successCount: 1, failedCount: 0 }),
    ).toThrow(/refusing to fabricate/i);
  });
});

describe('buildBulkPaymentUpdateBody', () => {
  it('serializes the documented camelCase bulk payload', () => {
    expect(
      buildBulkPaymentUpdateBody([
        { irn: 'IRN-1', paymentStatus: 'PAID', reference: 'BANKREF123' },
        { irn: 'IRN-2', payment_status: 'PENDING' },
      ]),
    ).toEqual({
      items: [
        { irn: 'IRN-1', paymentStatus: 'PAID', reference: 'BANKREF123' },
        { irn: 'IRN-2', paymentStatus: 'PENDING' },
      ],
    });
  });

  it('rejects a missing payment status', () => {
    expect(() => buildBulkPaymentUpdateBody([{ irn: 'IRN-1' }])).toThrow(
      /payment status/i,
    );
  });
});

describe('public CittaEFS resource endpoints', () => {
  afterEach(() => {
    nock.cleanAll();
    delete process.env.CITTAEFS_GATEWAY_URL;
  });

  it('fetches invoice types without auth', async () => {
    process.env.CITTAEFS_GATEWAY_URL = 'https://gateway.test';
    nock('https://gateway.test')
      .get('/api/resources/invoice-types')
      .reply(200, {
        success: true,
        data: [{ code: '381', value: 'Commercial Invoice' }],
      });
    await expect(cittaEfsClient.getResourceInvoiceTypes()).resolves.toEqual([
      { code: '381', value: 'Commercial Invoice' },
    ]);
  });

  it('surfaces a failed resource fetch', async () => {
    process.env.CITTAEFS_GATEWAY_URL = 'https://gateway.test';
    nock('https://gateway.test')
      .get('/api/resources/hs-codes')
      .reply(500, { success: false });
    await expect(cittaEfsClient.getResourceHsCodes()).rejects.toThrow(
      /hs-codes/,
    );
  });
});
