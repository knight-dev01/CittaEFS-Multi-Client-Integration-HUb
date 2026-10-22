import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

const h = vi.hoisted(() => {
  const makePrisma = () => {
    const m = () => vi.fn();
    return {
      invoice: { findFirst: m(), findMany: m(), findUnique: m(), update: m(), create: m(), count: m(), groupBy: m() },
      validationError: { findUnique: m(), update: m(), updateMany: m(), count: m() },
      tenant: { count: m(), findMany: m() },
      tenantErp: { findMany: m() },
      customer: { findFirst: m(), update: m() },
      item: { findFirst: m(), update: m(), create: m() },
      invoiceLineItem: { update: m() },
      auditLog: { create: m() },
      queueJob: { findMany: m(), findFirst: m() },
    };
  };
  return { prisma: makePrisma(), makePrisma };
});

vi.mock('../../lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('../../queues/invoiceQueue', () => ({ invoiceQueue: { add: vi.fn() } }));
vi.mock('../../services/odooService', () => ({ ingestOdooInvoice: vi.fn() }));
vi.mock('../../services/qboService', () => ({ ingestQboInvoice: vi.fn() }));

import validationRouter from '../../routes/validation';
import { invoiceQueue } from '../../queues/invoiceQueue';
import { ingestQboInvoice } from '../../services/qboService';

const ADMIN = { role: 'ADMIN', tenantId: 't1', email: 'admin@test.local' };
let currentUser: any = ADMIN;
let server: any;
let base = '';

const post = async (path: string, body: any) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

const TIN_ERROR = {
  id: 'err1',
  tenantId: 't1',
  errorCategory: 'INVALID_TIN_FORMAT',
  clientInvoiceNumber: 'INV001',
  fieldAffected: 'customerTin',
  errorMessage: 'Invalid TIN format for customer',
  sourceErp: 'qbo',
  rawPayloadSample: JSON.stringify({ Line: [] }),
};

const INVOICE_FIXTURE = {
  id: 'inv1',
  tenantId: 't1',
  clientInvoiceId: 'INV001',
  documentNumber: null,
  invoiceType: 'STANDARD',
  invoiceKind: 'B2B',
  issueDate: new Date('2026-01-15T00:00:00.000Z'),
  customerCode: 'C001',
  customerName: 'Acme Ltd',
  customerTin: 'OLDTIN',
  status: 'APPROVED',
  lineItems: [
    { id: 'li1', itemCode: 'KB1', description: 'Keyboard', quantity: 1, unitPrice: 50000, hsOrServiceCode: '8471', vatRate: 7.5 },
  ],
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    (req as any).user = currentUser;
    next();
  });
  app.use(validationRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as any;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.prisma, h.makePrisma());
  (invoiceQueue.add as any).mockResolvedValue(undefined);
  currentUser = { ...ADMIN };
});

describe('POST /api/validation-errors/resolve — TIN correction', () => {
  it('patches invoice customerTin and customer master with taxId only, then requeues', async () => {
    h.prisma.validationError.findUnique.mockResolvedValue(TIN_ERROR);
    h.prisma.invoice.findFirst.mockResolvedValue(INVOICE_FIXTURE);
    h.prisma.invoice.findUnique.mockResolvedValue(INVOICE_FIXTURE);
    h.prisma.invoice.update.mockResolvedValue(INVOICE_FIXTURE);
    h.prisma.customer.findFirst.mockResolvedValue({ id: 'cust1' });
    h.prisma.customer.update.mockResolvedValue({});
    h.prisma.validationError.update.mockResolvedValue({});
    h.prisma.auditLog.create.mockResolvedValue({});

    const { status, body } = await post('/api/validation-errors/resolve', {
      errorId: 'err1',
      correctedTin: ' gb1234567890 ',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.requeued).toBe(1);
    expect(body.invoiceCreated).toBe(false);
    expect(body.message).toContain('TIN corrected on invoice "INV001"');

    // customer master patched with taxId ONLY — no fields outside the schema
    expect(h.prisma.customer.update).toHaveBeenCalledTimes(1);
    const custCall = h.prisma.customer.update.mock.calls[0][0];
    expect(custCall).toEqual({ where: { id: 'cust1' }, data: { taxId: 'GB1234567890' } });
    expect(Object.keys(custCall.data)).toEqual(['taxId']);

    // invoice got the cleaned TIN; APPROVED status left untouched (no PENDING flip)
    expect(h.prisma.invoice.update).toHaveBeenCalledTimes(1);
    expect(h.prisma.invoice.update.mock.calls[0][0].data).toEqual({ customerTin: 'GB1234567890' });

    // requeued through the real ingestion schema + queue as signInvoice
    expect(invoiceQueue.add).toHaveBeenCalledTimes(1);
    expect((invoiceQueue.add as any).mock.calls[0][0]).toBe('signInvoice');
    // reconstructed from the persisted row via the real ingestion schema
    expect((invoiceQueue.add as any).mock.calls[0][1]).toMatchObject({
      dbInvoiceId: 'inv1',
      tenantId: 't1',
      clientInvoiceNumber: 'INV001',
    });

    // error closed out and audited
    expect(h.prisma.validationError.update).toHaveBeenCalledWith({ where: { id: 'err1' }, data: { status: 'RESOLVED' } });
    expect(h.prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('re-ingests from the stored QBO payload when no invoice exists yet', async () => {
    h.prisma.validationError.findUnique.mockResolvedValue(TIN_ERROR);
    h.prisma.customer.findFirst.mockResolvedValue({ id: 'cust2' });
    h.prisma.customer.update.mockResolvedValue({});
    h.prisma.validationError.update.mockResolvedValue({});
    h.prisma.auditLog.create.mockResolvedValue({});
    (ingestQboInvoice as any).mockResolvedValue({ clientInvoiceId: 'INV002', status: 'PENDING_NRS_STAMP' });

    const { status, body } = await post('/api/validation-errors/resolve', {
      errorId: 'err1',
      correctedTin: 'GB1234567890',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invoiceCreated).toBe(true);
    expect(body.message).toContain('invoice "INV002" created from the original QBO payload');
    expect(ingestQboInvoice).toHaveBeenCalledWith('t1', JSON.parse(TIN_ERROR.rawPayloadSample));

    // customer master still patched even without an invoice row
    expect(h.prisma.customer.update.mock.calls[0][0].data).toEqual({ taxId: 'GB1234567890' });
    expect(invoiceQueue.add).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown error id and does not touch the queue', async () => {
    h.prisma.validationError.findUnique.mockResolvedValue(null);

    const { status, body } = await post('/api/validation-errors/resolve', { errorId: 'nope', correctedTin: 'X' });

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(h.prisma.validationError.update).not.toHaveBeenCalled();
    expect(invoiceQueue.add).not.toHaveBeenCalled();
  });

  it('returns 403 when a non-admin tries to resolve another tenant error', async () => {
    currentUser = { role: 'USER', tenantId: 't2', email: 'user@test.local' };
    h.prisma.validationError.findUnique.mockResolvedValue(TIN_ERROR);

    const { status } = await post('/api/validation-errors/resolve', { errorId: 'err1', correctedTin: 'GB1234567890' });

    expect(status).toBe(403);
    expect(h.prisma.validationError.update).not.toHaveBeenCalled();
    expect(h.prisma.customer.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/validation-errors/resolve — HS code correction', () => {
  it('patches item dictionary + line item, flips rejected invoice back, and requeues', async () => {
    const hsError = {
      ...TIN_ERROR,
      id: 'err2',
      errorCategory: 'MISSING_HS_CODE',
      fieldAffected: 'lineItems',
      errorMessage: 'HS code UNMAPPED for Keyboard)',
    };
    h.prisma.validationError.findUnique.mockResolvedValue(hsError);
    h.prisma.invoice.findFirst.mockResolvedValue({ ...INVOICE_FIXTURE, status: 'REJECTED' });
    h.prisma.invoice.findUnique.mockResolvedValue({ ...INVOICE_FIXTURE, status: 'REJECTED' });
    h.prisma.item.findFirst.mockResolvedValue({ id: 'item1' });
    h.prisma.item.update.mockResolvedValue({});
    h.prisma.invoiceLineItem.update.mockResolvedValue({});
    h.prisma.invoice.update.mockResolvedValue({});
    h.prisma.validationError.update.mockResolvedValue({});
    h.prisma.auditLog.create.mockResolvedValue({});

    const { status, body } = await post('/api/validation-errors/resolve', {
      errorId: 'err2',
      hsOrServiceCode: '84716000',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.requeued).toBe(1);
    expect(body.message).toContain('HS code corrected on 1 invoice(s)');

    expect(h.prisma.item.update.mock.calls[0][0].data).toEqual({
      hsOrServiceCode: '84716000',
      categoryType: 'GOODS',
      isService: false,
    });
    expect(h.prisma.invoiceLineItem.update.mock.calls[0][0]).toEqual({
      where: { id: 'li1' },
      data: { hsOrServiceCode: '84716000' },
    });
    // rejected invoice re-enters the stamping pipeline
    expect(h.prisma.invoice.update.mock.calls[0][0].data).toEqual({ status: 'PENDING_NRS_STAMP' });
    expect((invoiceQueue.add as any).mock.calls[0][0]).toBe('signInvoice');
    expect(h.prisma.validationError.update).toHaveBeenCalledWith({ where: { id: 'err2' }, data: { status: 'RESOLVED' } });
  });
});

describe('GET /api/metrics — per-ERP breakdown', () => {
  it('aggregates counts, groupBy per-ERP stats, latency and ERP health', async () => {
    h.prisma.invoice.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(4) // approved+signed
      .mockResolvedValueOnce(7).mockResolvedValueOnce(4).mockResolvedValueOnce(2).mockResolvedValueOnce(1) // qbo
      .mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(0); // odoo
    h.prisma.tenant.count.mockResolvedValue(2);
    h.prisma.validationError.count.mockResolvedValue(3);
    h.prisma.queueJob.findMany.mockResolvedValue([
      { createdAt: new Date('2026-10-01T00:00:00.000Z'), updatedAt: new Date('2026-10-01T00:00:05.000Z') },
    ]);
    h.prisma.queueJob.findFirst.mockResolvedValue(null);
    h.prisma.invoice.groupBy.mockResolvedValue([
      { sourceErp: 'qbo', _count: { _all: 7 } },
      { sourceErp: 'odoo', _count: { _all: 3 } },
    ]);
    h.prisma.invoice.findMany.mockResolvedValue([]);
    h.prisma.tenantErp.findMany.mockResolvedValue([
      { id: 'c1', erpId: 'qbo', displayName: 'QuickBooks', companyId: 'qb1', status: 'ACTIVE', lastSyncAt: new Date(Date.now() - 60000) },
    ]);

    const { status, body } = await get('/api/metrics');

    expect(status).toBe(200);
    expect(body.totalInvoicesProcessed).toBe(10);
    expect(body.nrsStampSuccessRate).toBe(40);
    expect(body.activeTenantsCount).toBe(2);
    expect(body.pendingValidationCount).toBe(3);
    expect(body.averageLatencyMs).toBe(5000);
    expect(body.cittaGatewayStatus).toBe('ONLINE');
    expect(body.byErp).toEqual([
      { sourceErp: 'qbo', total: 7, approved: 4, pending: 2, rejected: 1, successRate: 57.1 },
      { sourceErp: 'odoo', total: 3, approved: 2, pending: 1, rejected: 0, successRate: 66.7 },
    ]);
    expect(body.timeseries).toEqual([]);
    expect(body.erpHealth).toHaveLength(1);
    expect(body.erpHealth[0].erpId).toBe('qbo');
    expect(body.erpHealth[0].lagSec).toBeGreaterThanOrEqual(50);
    expect(body.erpHealth[0].lagSec).toBeLessThanOrEqual(75);

    // grouped exactly once, by sourceErp, unscoped for admins
    expect(h.prisma.invoice.groupBy).toHaveBeenCalledTimes(1);
    const groupArgs = h.prisma.invoice.groupBy.mock.calls[0][0];
    expect(groupArgs.by).toEqual(['sourceErp']);
    expect(groupArgs._count).toEqual({ _all: true });
    expect(groupArgs.where).toBeUndefined();
  });

  it('scopes every aggregate to the tenant for non-admin users', async () => {
    currentUser = { role: 'USER', tenantId: 't9', email: 'user@test.local' };
    h.prisma.invoice.count.mockResolvedValue(0);
    h.prisma.tenant.count.mockResolvedValue(1);
    h.prisma.validationError.count.mockResolvedValue(0);
    h.prisma.queueJob.findMany.mockResolvedValue([]);
    h.prisma.queueJob.findFirst.mockResolvedValue(null);
    h.prisma.invoice.groupBy.mockResolvedValue([]);
    h.prisma.invoice.findMany.mockResolvedValue([]);
    h.prisma.tenantErp.findMany.mockResolvedValue([]);

    const { status } = await get('/api/metrics');

    expect(status).toBe(200);
    expect(h.prisma.invoice.count).toHaveBeenCalledWith({ where: { tenantId: 't9' } });
    expect(h.prisma.validationError.count).toHaveBeenCalledWith({ where: { tenantId: 't9', status: 'OPEN' } });
    const groupArgs = h.prisma.invoice.groupBy.mock.calls[0][0];
    expect(groupArgs.where).toEqual({ tenantId: 't9' });
    expect(h.prisma.tenant.count).toHaveBeenCalledWith({ where: { id: 't9' } });
  });
});

describe('POST /api/validation-errors/bulk-resolve', () => {
  it('resolves all open errors in scope and reports the count', async () => {
    h.prisma.validationError.updateMany.mockResolvedValue({ count: 2 });

    const { status, body } = await post('/api/validation-errors/bulk-resolve', { tenantId: 't1' });

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, resolved: 2 });
    expect(h.prisma.validationError.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', status: 'OPEN' },
      data: { status: 'RESOLVED' },
    });
  });

  it('returns 403 when a non-admin targets another tenant', async () => {
    currentUser = { role: 'USER', tenantId: 't2', email: 'user@test.local' };

    const { status } = await post('/api/validation-errors/bulk-resolve', { tenantId: 't1' });

    expect(status).toBe(403);
    expect(h.prisma.validationError.updateMany).not.toHaveBeenCalled();
  });
});
