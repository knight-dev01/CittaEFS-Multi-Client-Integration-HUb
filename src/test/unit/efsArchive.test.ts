import { describe, it, expect } from 'vitest';
import {
  unwrapArchive, readField, stampFromArchiveRecord, indexArchive, findArchiveRecord, pickWebhookInvoice,
} from '../../lib/efsArchive';

describe('unwrapArchive', () => {
  it('accepts a bare array or a common envelope', () => {
    const rows = [{ invoiceNumber: 'INV1' }];
    expect(unwrapArchive(rows)).toBe(rows);
    expect(unwrapArchive({ data: rows })).toBe(rows);
    expect(unwrapArchive({ Items: rows })).toBe(rows);
    expect(unwrapArchive({ data: { invoices: rows } })).toBe(rows);
    expect(unwrapArchive({ success: true })).toEqual([]);
    expect(unwrapArchive(null)).toEqual([]);
  });
});

describe('readField', () => {
  it('ignores case and underscores', () => {
    expect(readField({ Irn: 'X' }, 'irn')).toBe('X');
    expect(readField({ qr_code: 'Q' }, 'qrCode')).toBe('Q');
    expect(readField({ irn: '' }, 'irn')).toBeUndefined();
  });
});

describe('stampFromArchiveRecord', () => {
  it('reads IRN and turns a base64 QR image into a data URL', () => {
    expect(stampFromArchiveRecord({ IRN: 'IRN1', Status: 'TRANSMITTED', QrCode: 'iVBOR' })).toEqual({
      irn: 'IRN1', csid: null, qrCodeUrl: 'data:image/png;base64,iVBOR', status: 'TRANSMITTED',
    });
  });
  it('keeps a QR URL as is', () => {
    expect(stampFromArchiveRecord({ irn: 'IRN1', qrCodeUrl: 'https://v/1' })?.qrCodeUrl).toBe('https://v/1');
  });
  it('returns null without an IRN or for a failed record', () => {
    expect(stampFromArchiveRecord({ invoiceNumber: 'INV1', status: 'QUEUED' })).toBeNull();
    expect(stampFromArchiveRecord({ irn: 'IRN1', status: 'TRANSMIT_FAILED' })).toBeNull();
    expect(stampFromArchiveRecord(undefined)).toBeNull();
  });
});

describe('archive matching', () => {
  const index = indexArchive([
    { invoiceNumber: 'INV1001', sourceNbr: 'INV-1001', irn: 'IRN-A' },
    { invoiceNumber: 'CM1005', sourceNbr: '1005', irn: 'IRN-CM' },
    { invoiceNumber: '1005', sourceNbr: '1005', irn: 'IRN-INV' },
    { invoiceNumber: 'INV202600012', irn: 'IRN-ODOO' },
  ]);
  it('matches the ERP number through its A-Z/0-9 form', () => {
    expect(findArchiveRecord(index, { clientInvoiceId: 'INV-1001' })?.irn).toBe('IRN-A');
    expect(findArchiveRecord(index, { clientInvoiceId: 'INV/2026/00012' })?.irn).toBe('IRN-ODOO');
  });
  it('never gives a credit memo the invoice\'s stamp, or the reverse', () => {
    expect(findArchiveRecord(index, { clientInvoiceId: 'CM-1005' })?.irn).toBe('IRN-CM');
    expect(findArchiveRecord(index, { clientInvoiceId: '1005' })?.irn).toBe('IRN-INV');
  });
  it('finds nothing for an invoice EFS has not archived', () => {
    expect(findArchiveRecord(index, { clientInvoiceId: '9999' })).toBeUndefined();
  });
});

describe('pickWebhookInvoice', () => {
  const row = (id: string, clientInvoiceId: string, status: string, createdAt: string, irn: string | null = null) =>
    ({ id, clientInvoiceId, status, createdAt, irn });

  it('picks the invoice still awaiting a stamp over an older stamped one with the same number', () => {
    const picked = pickWebhookInvoice([
      row('old', '1001', 'APPROVED', '2026-01-01', 'IRN-OLD'),
      row('new', '1001', 'PENDING_NRS_STAMP', '2026-11-25'),
    ], { invoiceNumber: '1001', irn: 'IRN-NEW' });
    expect(picked?.id).toBe('new');
  });

  it('prefers the exact number over a row matched by the echoed source number', () => {
    const picked = pickWebhookInvoice([
      row('inv', '1005', 'PENDING_NRS_STAMP', '2026-11-25'),
      row('cm', 'CM-1005', 'PENDING_NRS_STAMP', '2026-11-24'),
    ], { invoiceNumber: 'CM1005', sourceNbr: '1005', irn: 'IRN-CM' });
    expect(picked?.id).toBe('cm');
  });

  it('returns the row already holding the IRN for a repeated event', () => {
    const picked = pickWebhookInvoice([
      row('a', 'INV-1', 'APPROVED', '2026-11-20', 'IRN-1'),
      row('b', 'INV-1', 'PENDING_NRS_STAMP', '2026-11-25'),
    ], { invoiceNumber: 'INV1', irn: 'IRN-1' });
    expect(picked?.id).toBe('a');
  });

  it('returns null when nothing matched', () => {
    expect(pickWebhookInvoice([], { invoiceNumber: 'X' })).toBeNull();
  });
});

describe('matching on the HubInvoiceId echoed in metadata', () => {
  it('archive: the tagged record wins over a number match', () => {
    const index = indexArchive([
      { invoiceNumber: '1001', irn: 'IRN-OTHER-TENANT-COPY' },
      { invoiceNumber: '1001', irn: 'IRN-MINE', metadata: { HubInvoiceId: 'hub-42' } },
    ]);
    expect(findArchiveRecord(index, { id: 'hub-42', clientInvoiceId: '1001' })?.irn).toBe('IRN-MINE');
  });
  it('webhook: the tagged row wins even when an older row is still pending', () => {
    const picked = pickWebhookInvoice([
      { id: 'hub-1', clientInvoiceId: '1001', status: 'PENDING_NRS_STAMP', createdAt: '2026-11-25', irn: null },
      { id: 'hub-2', clientInvoiceId: '1001', status: 'PENDING_NRS_STAMP', createdAt: '2026-11-20', irn: null },
    ], { invoiceNumber: '1001', hubInvoiceId: 'hub-2' });
    expect(picked?.id).toBe('hub-2');
  });
});
