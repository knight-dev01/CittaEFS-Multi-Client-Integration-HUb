import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';

const odoo = vi.hoisted(() => ({
  verifyOdooWebhookToken: vi.fn(),
  fetchOdooInvoiceById: vi.fn(),
  ingestOdooInvoice: vi.fn(),
  writebackProblemToOdoo: vi.fn(async () => {}),
}));
const integrationFindFirst = vi.hoisted(() => vi.fn());
const runWorkerBatch = vi.hoisted(() => vi.fn(async () => []));

vi.mock('../../services/odooService', () => odoo);
vi.mock('../../lib/prisma', () => ({ prisma: { integration: { findFirst: integrationFindFirst } } }));
vi.mock('../../workers/invoiceWorker', () => ({ runWorkerBatch }));
vi.mock('../../lib/eventBus', () => ({ broadcastEvent: vi.fn() }));
vi.mock('../../services/qboService', () => ({ fetchAndIngestSpecificQboInvoice: vi.fn() }));
vi.mock('../../services/cittaEfsClient', () => ({ cittaEfsClient: {} }));
vi.mock('../../services/merchantWebhook', () => ({ dispatchMerchantWebhook: vi.fn() }));
vi.mock('../../lib/erpProblemWriteback', () => ({ writeProblemBackToSourceErp: vi.fn() }));
vi.mock('../../lib/serverHelpers', () => ({ generateSha256: () => 'h', safeAuditLogCreate: vi.fn() }));

let base = '';
let server: any;
beforeAll(async () => {
  const { default: router } = await import('../../routes/webhooks');
  const app = express();
  app.use(express.json());
  app.use(router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());
beforeEach(() => {
  vi.clearAllMocks();
  integrationFindFirst.mockResolvedValue({ status: 'CONNECTED' });
});

const post = (path: string, body: any) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/webhooks/odoo/:tenantId', () => {
  it('rejects a wrong token without touching Odoo', async () => {
    odoo.verifyOdooWebhookToken.mockResolvedValue(false);
    const res = await post('/api/webhooks/odoo/t1?token=bad', { _id: 5, _model: 'account.move' });
    expect(res.status).toBe(401);
    expect(odoo.fetchOdooInvoiceById).not.toHaveBeenCalled();
  });

  it('re-reads the invoice from Odoo and ingests that, ignoring body fields', async () => {
    odoo.verifyOdooWebhookToken.mockResolvedValue(true);
    const fromOdoo = { id: 5, name: 'INV/2026/0005', amount_total: 100 };
    odoo.fetchOdooInvoiceById.mockResolvedValue(fromOdoo);
    odoo.ingestOdooInvoice.mockResolvedValue({ clientInvoiceId: 'INV/2026/0005', status: 'QUEUED' });
    const res = await post('/api/webhooks/odoo/t1?token=good', { _id: 5, _model: 'account.move', amount_total: 999999 });
    expect(res.status).toBe(200);
    expect(odoo.fetchOdooInvoiceById).toHaveBeenCalledWith('t1', 5);
    expect(odoo.ingestOdooInvoice).toHaveBeenCalledWith('t1', fromOdoo);
    expect(runWorkerBatch).toHaveBeenCalled();
  });

  it('ignores drafts, vendor bills and other models', async () => {
    odoo.verifyOdooWebhookToken.mockResolvedValue(true);
    odoo.fetchOdooInvoiceById.mockResolvedValue(null);
    expect(await (await post('/api/webhooks/odoo/t1?token=good', { _id: 6 })).json()).toMatchObject({ ignored: expect.any(String) });
    expect(await (await post('/api/webhooks/odoo/t1?token=good', { _id: 6, _model: 'res.partner' })).json()).toMatchObject({ ignored: 'model res.partner' });
    expect(odoo.ingestOdooInvoice).not.toHaveBeenCalled();
  });

  it('writes an ingest problem back to the Odoo invoice', async () => {
    odoo.verifyOdooWebhookToken.mockResolvedValue(true);
    odoo.fetchOdooInvoiceById.mockResolvedValue({ id: 7, name: 'INV/7' });
    odoo.ingestOdooInvoice.mockRejectedValue(new Error('Customer TIN missing'));
    const res = await post('/api/webhooks/odoo/t1?token=good', { _id: 7 });
    expect(res.status).toBe(422);
    expect(odoo.writebackProblemToOdoo).toHaveBeenCalledWith('t1', '7', 'Customer TIN missing');
  });
});
