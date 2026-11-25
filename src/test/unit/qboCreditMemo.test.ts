import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import nock from 'nock';

// ---- fake database: each test sets the handlers it needs ----
const db = vi.hoisted(() => {
  const calls: { model: string; method: string; args: any }[] = [];
  let handler: (model: string, method: string, args: any) => any = () => null;
  return {
    calls,
    setHandler(h: typeof handler) { handler = h; },
    client: new Proxy({}, {
      get: (_t, model: string) => new Proxy({}, {
        get: (_t2, method: string) => async (args: any) => {
          calls.push({ model, method, args });
          return handler(model, method, args);
        },
      }),
    }),
  };
});
vi.mock('@prisma/client', () => ({ PrismaClient: class { constructor() { return db.client; } } }));
vi.mock('../../config/dbConfig', () => ({ getDatabaseUrl: () => 'postgresql://unused' }));
vi.mock('../../queues/invoiceQueue', () => ({ invoiceQueue: { add: vi.fn() } }));
vi.mock('../../connectors', async (orig) => ({ ...(await orig<any>()), ensureFreshAccessToken: async () => 'qbo-token' }));

import {
  qboClientInvoiceId,
  qboEntityForInvoiceType,
  isQboCreditMemo,
  fetchQboInvoicePage,
  ingestQboInvoice,
  writebackToQbo,
} from '../../services/qboService';

const QBO = 'https://sandbox-quickbooks.api.intuit.com';
const integration = { id: 'i1', companyId: 'realm1', lastSyncAt: null, environment: 'sandbox', sourceSystem: 'QUICKBOOKS_ONLINE' };

function defaultHandler(model: string, method: string, _args: any) {
  if (model === 'integration' && (method === 'findFirst' || method === 'findUnique')) return integration;
  if (method === 'findMany') return [];
  if (method === 'create') return { id: 'new', ..._args?.data };
  return null;
}

beforeAll(() => {
  process.env.QBO_CLIENT_ID = 'cid';
  process.env.QBO_CLIENT_SECRET = 'secret';
  nock.disableNetConnect();
});
afterAll(() => { nock.cleanAll(); nock.enableNetConnect(); });
beforeEach(() => { db.calls.length = 0; db.setHandler(defaultHandler); nock.cleanAll(); });

describe('QBO credit memo helpers', () => {
  it('keys credit memos with a CM- prefix so they never collide with invoice numbers', () => {
    expect(qboClientInvoiceId({ Id: '9', DocNumber: '1005' })).toBe('1005');
    expect(qboClientInvoiceId({ Id: '9', DocNumber: '1005', TxnType: 'CreditMemo' })).toBe('CM-1005');
    expect(qboClientInvoiceId({ Id: '9', DocNumber: 'CM77', TxnType: 'CreditMemo' })).toBe('CM77');
    expect(qboClientInvoiceId({ Id: '9', TxnType: 'CreditMemo' })).toBe('CM-QBO-9');
  });

  it('maps hub invoice type to the QBO entity', () => {
    expect(qboEntityForInvoiceType('CREDIT_NOTE')).toBe('CreditMemo');
    expect(qboEntityForInvoiceType('STANDARD')).toBe('Invoice');
    expect(qboEntityForInvoiceType(null)).toBe('Invoice');
    expect(isQboCreditMemo({ TxnType: 'CreditMemo' })).toBe(true);
  });
});

describe('fetchQboInvoicePage: invoices, then credit memos', () => {
  it('moves from the invoice phase to the credit-memo phase and tags credit memos', async () => {
    nock(QBO).get('/v3/company/realm1/query').query(q => String(q.query).startsWith('SELECT * FROM Invoice STARTPOSITION 1 '))
      .reply(200, { QueryResponse: { Invoice: [{ Id: '1', DocNumber: '1001' }] } });
    nock(QBO).get('/v3/company/realm1/query').query(q => String(q.query).startsWith('SELECT * FROM CreditMemo STARTPOSITION 1 '))
      .reply(200, { QueryResponse: { CreditMemo: [{ Id: '1', DocNumber: '1001' }] } });

    const p1 = await fetchQboInvoicePage('t1', null, { maxResults: 10 });
    expect(p1.records).toEqual([{ Id: '1', DocNumber: '1001' }]);
    expect(p1.nextCursor).toBe(-1); // invoices done -> credit memos

    const p2 = await fetchQboInvoicePage('t1', p1.nextCursor, { maxResults: 10 });
    expect(p2.records).toEqual([{ Id: '1', DocNumber: '1001', TxnType: 'CreditMemo' }]);
    expect(p2.nextCursor).toBeNull();
  });

  it('pages within each phase', async () => {
    nock(QBO).get('/v3/company/realm1/query').query(q => String(q.query).includes('FROM CreditMemo STARTPOSITION 3 MAXRESULTS 2'))
      .reply(200, { QueryResponse: { CreditMemo: [{ Id: 'a' }, { Id: 'b' }] } });
    const p = await fetchQboInvoicePage('t1', -3, { maxResults: 2 });
    expect(p.nextCursor).toBe(-5);
  });
});

describe('ingestQboInvoice with a credit memo', () => {
  it('stores CM-<DocNumber> as a CREDIT_NOTE linked to the original IRN', async () => {
    db.setHandler((model, method, args) => {
      if (model === 'invoice' && method === 'findFirst') {
        // billing-reference lookup for the linked original invoice
        if (args?.where?.qboInvoiceId === '55' && args?.where?.irn) return { irn: 'IRN-ORIGINAL-1' };
        return null;
      }
      if (model === 'item' && method === 'findMany') return [{ clientSku: 'LAP01', hsOrServiceCode: '8471.30', defaultVatRate: 7.5 }];
      return defaultHandler(model, method, args);
    });

    await ingestQboInvoice('t1', {
      Id: '12', DocNumber: '1005', TxnType: 'CreditMemo', TxnDate: '2026-11-17',
      CustomerRef: { value: '20', name: 'Acme' },
      LinkedTxn: [{ TxnId: '55', TxnType: 'Invoice' }],
      Line: [{ DetailType: 'SalesItemLineDetail', Description: 'Laptop', SalesItemLineDetail: { ItemRef: { name: 'LAP01' }, Qty: 1, UnitPrice: 100 } }],
    }, { autoEnqueue: false });

    const created = db.calls.find(c => c.model === 'invoice' && c.method === 'create')!.args.data;
    expect(created.clientInvoiceId).toBe('CM-1005');
    expect(created.documentNumber).toBe('1005');
    expect(created.qboInvoiceId).toBe('12');
    expect(created.invoiceType).toBe('CREDIT_NOTE');
    expect(created.billingReferenceIrns).toBe('IRN-ORIGINAL-1');
  });

  it('does not treat an invoice with the same QBO Id as an existing credit memo', async () => {
    await ingestQboInvoice('t1', {
      Id: '12', DocNumber: '1005', TxnType: 'CreditMemo', TxnDate: '2026-11-17', CustomerRef: { value: '20', name: 'Acme' }, Line: [],
    }, { autoEnqueue: false }).catch(() => {});
    const legacy = db.calls.find(c => c.model === 'invoice' && c.method === 'findFirst' && c.args?.where?.qboInvoiceId === '12');
    expect(legacy?.args.where.invoiceType).toBe('CREDIT_NOTE');
  });
});

describe('writebackToQbo for a credit memo', () => {
  it('reads and updates the creditmemo entity, not invoice', async () => {
    db.setHandler((model, method, args) => {
      if (model === 'invoice' && method === 'findFirst' && args?.where?.clientInvoiceId === 'CM-1005') {
        return { clientInvoiceId: 'CM-1005', qboInvoiceId: '12', invoiceType: 'CREDIT_NOTE' };
      }
      return defaultHandler(model, method, args);
    });
    const read = nock(QBO).get('/v3/company/realm1/creditmemo/12').query(true)
      .reply(200, { CreditMemo: { Id: '12', SyncToken: '3', PrivateNote: '', CustomField: [
        { DefinitionId: '1', Name: 'Crew #', Type: 'StringType' },
        { DefinitionId: '2', Name: 'IRN', Type: 'StringType' },
        { DefinitionId: '3', Name: 'QR Code', Type: 'StringType' },
      ] } });
    let posted: any = null;
    let customFieldPost: any = null;
    const write = nock(QBO).post('/v3/company/realm1/creditmemo', (b: any) => {
      if (b.CustomField) customFieldPost = b; else posted ??= b;
      return true;
    }).query(true).times(2)
      .reply(200, { CreditMemo: { Id: '12', SyncToken: '4' } });

    await writebackToQbo('t1', 'CM-1005', 'IRN-CM-1', 'https://verify.example/IRN-CM-1');

    expect(read.isDone()).toBe(true);
    expect(write.isDone()).toBe(true);
    expect(posted.Id).toBe('12');
    expect(posted.PrivateNote).toContain('IRN-CM-1');
    // IRN and QR land in the fields named for them, not in field 1.
    expect(customFieldPost.CustomField).toEqual([
      { DefinitionId: '2', Type: 'StringType', StringValue: 'IRN-CM-1' },
      { DefinitionId: '3', Type: 'StringType', StringValue: 'See QR attachment' },
    ]);
  });
});
