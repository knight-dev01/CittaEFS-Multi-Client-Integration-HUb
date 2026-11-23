import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../config/dbConfig', () => ({ getDatabaseUrl: () => 'postgresql://u:p@localhost:5432/x' }));
vi.mock('../../queues/invoiceQueue', () => ({ invoiceQueue: { add: vi.fn() } }));

import { postOdooInvoiceMessage } from '../../services/odooService';

const creds = { url: 'https://odoo.test', database: 'db', username: 'u', apiKey: 'k', uid: 2 };

function rpcServer(handler: (model: string, method: string, args: any[], kw: any) => any) {
  const calls: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    const { params } = JSON.parse(init.body);
    const [, , , model, method, args, kw] = params.args;
    calls.push({ model, method, args, kw });
    try {
      return { ok: true, json: async () => ({ result: handler(model, method, args, kw) }) };
    } catch (e: any) {
      return { ok: true, json: async () => ({ error: { message: e.message } }) };
    }
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('postOdooInvoiceMessage', () => {
  it('notifies internal users (not portal users or the customer) in their Odoo Inbox', async () => {
    const calls = rpcServer((model, method) => {
      if (model === 'account.move' && method === 'read') return [{ invoice_user_id: [7, 'Ada'], create_uid: [9, 'Portal'] }];
      if (model === 'res.users') return [
        { id: 7, partner_id: [70, 'Ada'], share: false, active: true },
        { id: 9, partner_id: [90, 'Portal'], share: true, active: true },
        { id: 2, partner_id: [20, 'Hub user'], share: false, active: true },
      ];
      return 1;
    });
    const res = await postOdooInvoiceMessage(creds, 42, '<p>IRN</p>', [5]);
    expect(res.inboxNotified).toBe(2);
    const post = calls.find(c => c.method === 'message_post');
    expect(post.args).toEqual([[42]]);
    expect(post.kw).toMatchObject({
      body: '<p>IRN</p>', attachment_ids: [5], message_type: 'comment',
      subtype_xmlid: 'mail.mt_note', partner_ids: [70, 20], context: { mail_notify_author: true },
    });
  });

  it('still posts to the chatter when the instance rejects inbox options', async () => {
    let posts = 0;
    const calls = rpcServer((model, method, _a, kw) => {
      if (model === 'account.move' && method === 'read') return [{ invoice_user_id: false, create_uid: [2, 'Hub'] }];
      if (model === 'res.users') return [{ id: 2, partner_id: [20, 'Hub'], share: false }];
      if (method === 'message_post') { posts++; if (kw.subtype_xmlid) throw new Error('unexpected keyword'); return 1; }
    });
    const res = await postOdooInvoiceMessage(creds, 42, 'Problem');
    expect(res.inboxNotified).toBe(0);
    expect(posts).toBe(2);
    expect(calls.at(-1).kw).toEqual({ body: 'Problem' });
  });
});

describe('latestOdooWriteDate', () => {
  it('reads Odoo UTC timestamps and picks the newest', async () => {
    const { latestOdooWriteDate } = await import('../../services/odooService');
    expect(latestOdooWriteDate([{ write_date: '2026-11-23 10:00:05' }, { write_date: '2026-11-23 10:00:09' }, { write_date: false }])
      ?.toISOString()).toBe('2026-11-23T10:00:09.000Z');
    expect(latestOdooWriteDate([])).toBeNull();
  });
});
