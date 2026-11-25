import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';

const findUnique = vi.fn();
vi.mock('../../lib/prisma', () => ({ prisma: { invoice: { findUnique: (...a: any[]) => findUnique(...a) } } }));

import { qrToken, invoiceIdFromQrToken, qrLinkFor } from '../../lib/qrLink';
import qrRouter from '../../routes/qr';

const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64');
const env = { ...process.env };

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-for-qr-links';
  process.env.HUB_API_PUBLIC_URL = 'https://hub.example.com/';
  findUnique.mockReset();
});
afterEach(() => { process.env = { ...env }; });

describe('signed QR links', () => {
  it('round-trips the invoice id and rejects tampering', () => {
    const token = qrToken('inv-123')!;
    expect(invoiceIdFromQrToken(token)).toBe('inv-123');
    expect(invoiceIdFromQrToken(token.replace('inv-123', 'inv-124'))).toBeNull();
    expect(invoiceIdFromQrToken('inv-123.wrongsignature0000000')).toBeNull();
    expect(invoiceIdFromQrToken('no-dot')).toBeNull();
  });

  it('builds the public link from the hub address', () => {
    expect(qrLinkFor('inv-123')).toBe(`https://hub.example.com/qr/${qrToken('inv-123')}`);
  });

  it('makes no link without a persistent secret or a public address', () => {
    delete process.env.JWT_SECRET;
    expect(qrLinkFor('inv-123')).toBeNull();
    process.env.JWT_SECRET = 'x';
    delete process.env.HUB_API_PUBLIC_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    expect(qrLinkFor('inv-123')).toBeNull();
  });
});

/** GET against the router on a throwaway local server. */
async function get(path: string): Promise<{ status: number; text: string; type: string; bytes: Buffer }> {
  const server = express().use(qrRouter).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, text: bytes.toString(), type: res.headers.get('content-type') || '', bytes };
  } finally {
    server.close();
  }
}

describe('public QR page', () => {
  const stamped = { clientInvoiceId: 'INV-1001', issueDate: new Date('2026-11-25'), irn: 'IRN-ABC', qrCodeUrl: `data:image/png;base64,${PNG_B64}`, status: 'APPROVED' };

  it('shows the IRN and QR for a stamped invoice, without amounts or customer', async () => {
    findUnique.mockResolvedValue(stamped);
    const token = qrToken('inv-1')!;
    const res = await get(`/qr/${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('INV-1001');
    expect(res.text).toContain('IRN-ABC');
    expect(res.text).toContain(`/qr/${encodeURIComponent(token)}/qr.png`);
    expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('customerName');
    expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('totalAmount');
  });

  it('serves the QR image', async () => {
    findUnique.mockResolvedValue(stamped);
    const res = await get(`/qr/${qrToken('inv-1')}/qr.png`);
    expect(res.status).toBe(200);
    expect(res.type).toContain('image/png');
    expect(res.bytes.toString()).toBe('fake-png-bytes');
  });

  it('404s on a forged token without reading the database', async () => {
    const res = await get('/qr/inv-1.forgedforgedforgedforg');
    expect(res.status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('404s for an invoice that is not stamped', async () => {
    findUnique.mockResolvedValue({ ...stamped, status: 'PENDING_NRS_STAMP', irn: null });
    const res = await get(`/qr/${qrToken('inv-1')}`);
    expect(res.status).toBe(404);
  });
});
