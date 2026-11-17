import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { toEfsInvoiceNumber } from '../../lib/efsInvoiceNumber';

describe('EFS invoice number (A-Z / 0-9 only)', () => {
  it('converts QuickBooks and Odoo numbering', () => {
    expect(toEfsInvoiceNumber('INV-1001')).toBe('INV1001');
    expect(toEfsInvoiceNumber('INV/2026/00012')).toBe('INV202600012');
    expect(toEfsInvoiceNumber('RINV/2026/0003')).toBe('RINV20260003');
    expect(toEfsInvoiceNumber('1045')).toBe('1045');
  });

  it('uppercases and strips spaces, underscores and other symbols', () => {
    expect(toEfsInvoiceNumber(' inv_7 ')).toBe('INV7');
    expect(toEfsInvoiceNumber('A.B#C 9')).toBe('ABC9');
  });

  it('leaves already-valid numbers unchanged', () => {
    expect(toEfsInvoiceNumber('INV2024001')).toBe('INV2024001');
  });

  it('falls back to the original when nothing usable remains', () => {
    expect(toEfsInvoiceNumber('/')).toBe('/');
    expect(toEfsInvoiceNumber('')).toBe('');
    expect(toEfsInvoiceNumber(null)).toBe('');
  });
});

// What actually goes over the wire to CittaEFS.
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    tenant = {
      findUnique: async () => ({ cittaApiKey: '', cittaGatewayUrl: 'https://efs.test.local', cittaWritebackTarget: 'BOTH' }),
      findFirst: async () => null,
    };
  },
}));
vi.mock('../../config/dbConfig', () => ({ getDatabaseUrl: () => 'postgresql://unused' }));

describe('signAndStampInvoice payload', () => {
  const prevKey = process.env.CITTAEFS_API_KEY;
  const prevUrl = process.env.CITTAEFS_GATEWAY_URL;
  beforeAll(() => {
    process.env.CITTAEFS_API_KEY = 'test-key';
    process.env.CITTAEFS_GATEWAY_URL = 'https://efs.test.local';
    nock.disableNetConnect();
  });
  afterAll(() => {
    process.env.CITTAEFS_API_KEY = prevKey;
    process.env.CITTAEFS_GATEWAY_URL = prevUrl;
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('sends the A-Z/0-9 invoiceNumber and keeps the ERP number as documentNumber', async () => {
    let sent: any[] = [];
    nock('https://efs.test.local')
      .post('/api/integration/gen/invoices', (body: any) => { sent = body; return true; })
      .reply(200, { success: true, totalInvoices: 1, validCount: 1, invalidCount: 0, validInvoices: ['INV202600012'], invalidInvoices: [], errors: [] });

    const { cittaEfsClient } = await import('../../services/cittaEfsClient');
    await cittaEfsClient.signAndStampInvoice({
      tenantId: 't1',
      clientInvoiceNumber: 'INV/2026/00012',
      issueDate: '2026-11-17',
      customerCode: 'CUST1',
      invoiceType: 'STANDARD',
      lineItems: [{ itemCode: 'LAP01', description: 'Laptop', quantity: 1, unitPrice: 100, vatAmount: 7.5, taxableAmount: 100, hsOrServiceCode: '8471.30' }],
    } as any);

    expect(sent).toHaveLength(1);
    expect(sent[0].invoiceNumber).toBe('INV202600012');
    expect(sent[0].documentNumber).toBe('INV/2026/00012');
  });
});
