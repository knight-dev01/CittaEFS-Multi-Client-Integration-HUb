import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyEmailAddress, filterDeliverable, clearEmailCheckCache, type DnsLike } from '../../services/emailVerify';
import { extractQboCompanyEmails, extractOdooCompanyEmails } from '../../services/erpContactEmail';
import { buildApprovalDigestEmail, buildDigestEmail } from '../../lib/errorDigestFormat';

// Fake DNS: no network in unit tests.
function fakeDns(records: Record<string, { mx?: string[]; a?: string[]; fail?: string }>): DnsLike {
  const err = (code: string) => Object.assign(new Error(code), { code });
  const get = (d: string) => {
    const r = records[d];
    if (!r) throw err('ENOTFOUND');
    if (r.fail) throw err(r.fail);
    return r;
  };
  return {
    async resolveMx(d) {
      const r = get(d);
      if (!r.mx) throw err('ENODATA');
      return r.mx.map((exchange, i) => ({ exchange, priority: i }));
    },
    async resolve4(d) {
      const r = get(d);
      if (!r.a) throw err('ENODATA');
      return r.a;
    },
    async resolve6() {
      throw err('ENODATA');
    },
  };
}

const dns = fakeDns({
  'acme.ng': { mx: ['mx1.acme.ng'] },
  'gmail.com': { mx: ['gmail-smtp-in.l.google.com'] },
  'hostonly.ng': { a: ['10.0.0.1'] },
  'nomail.ng': { mx: ['.'] },
  'flaky.ng': { fail: 'ETIMEOUT' },
});

describe('email "is it real?" check', () => {
  beforeEach(() => clearEmailCheckCache());

  it('accepts an address whose domain has a mail server', async () => {
    expect((await verifyEmailAddress('Finance@Acme.ng', dns)).status).toBe('valid');
  });

  it('accepts a domain with no MX but a host address (implicit MX)', async () => {
    expect((await verifyEmailAddress('a@hostonly.ng', dns)).status).toBe('valid');
  });

  it('rejects a misspelt / non-existent domain', async () => {
    const r = await verifyEmailAddress('finance@gmial.com', dns);
    expect(r.status).toBe('invalid');
    expect(r.reason).toContain('no mail server');
  });

  it('rejects a domain that publishes a null MX (accepts no mail)', async () => {
    expect((await verifyEmailAddress('x@nomail.ng', dns)).status).toBe('invalid');
  });

  it('rejects malformed addresses without a DNS lookup', async () => {
    const spy = vi.spyOn(dns, 'resolveMx');
    for (const bad of ['plainaddress', 'a@b', 'a b@acme.ng', '@acme.ng', 'a@-acme.ng']) {
      expect((await verifyEmailAddress(bad, dns)).status).toBe('invalid');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects reserved and non-deliverable domains', async () => {
    for (const p of ['admin@example.com', 'you@yourdomain.com', 'qa@shop.test', 'a@mailinator.com']) {
      expect((await verifyEmailAddress(p, dns)).status).toBe('invalid');
    }
  });

  it('reports "unknown" (still sendable) when DNS is unreachable', async () => {
    expect((await verifyEmailAddress('a@flaky.ng', dns)).status).toBe('unknown');
  });

  it('filterDeliverable keeps valid + unknown and drops invalid', async () => {
    const r = await filterDeliverable(['ok@acme.ng', 'bad@gmial.com', 'maybe@flaky.ng', 'demo@example.com'], dns);
    expect(r.deliverable).toEqual(['ok@acme.ng', 'maybe@flaky.ng']);
    expect(r.rejected.map(c => c.email)).toEqual(['bad@gmial.com', 'demo@example.com']);
  });
});

describe('ERP company email extraction', () => {
  it('reads the QuickBooks CompanyInfo email, falling back to the customer-communication address', () => {
    expect(extractQboCompanyEmails({ Email: { Address: 'Books@Acme.ng' }, CustomerCommunicationEmailAddr: { Address: 'billing@acme.ng' } })).toEqual(['books@acme.ng']);
    expect(extractQboCompanyEmails({ CustomerCommunicationEmailAddr: { Address: 'billing@acme.ng' } })).toEqual(['billing@acme.ng']);
    expect(extractQboCompanyEmails({})).toEqual([]);
    expect(extractQboCompanyEmails(null)).toEqual([]);
  });

  it('reads the Odoo res.company email (Odoo returns false when unset)', () => {
    expect(extractOdooCompanyEmails({ name: 'Acme', email: 'info@acme.ng' })).toEqual(['info@acme.ng']);
    expect(extractOdooCompanyEmails({ name: 'Acme', email: false })).toEqual([]);
    expect(extractOdooCompanyEmails(null)).toEqual([]);
  });
});

describe('approval (IRN issued) email', () => {
  const tenant = { id: 't1', companyName: 'Acme Nigeria Ltd' };
  const approval = {
    clientInvoiceId: 'INV-2001',
    customerName: 'Dangote <Retail>',
    totalAmount: 107500,
    currency: 'NGN',
    irn: 'INV2001-94ND90NR-20261117',
    sourceErp: 'qbo',
    updatedAt: new Date('2026-11-17T09:00:00Z'),
  };

  it('lists invoice, customer, amount and IRN, and says no action is needed', () => {
    const mail = buildApprovalDigestEmail(tenant, [approval, { ...approval, clientInvoiceId: 'INV/2026/0007', sourceErp: 'odoo' }], 'https://hub.example.com');
    expect(mail.subject).toBe('[CittaEFS] 2 invoices approved by NRS - Acme Nigeria Ltd');
    expect(mail.text).toContain('INV-2001 [QuickBooks Online]');
    expect(mail.text).toContain('INV/2026/0007 [Odoo]');
    expect(mail.text).toContain('IRN INV2001-94ND90NR-20261117');
    expect(mail.text).toContain('No action is needed');
    expect(mail.html).toContain('107,500');
  });

  it('escapes ERP-supplied text', () => {
    const mail = buildApprovalDigestEmail(tenant, [approval]);
    expect(mail.html).not.toContain('<Retail>');
    expect(mail.html).toContain('&lt;Retail&gt;');
  });

  it('error email no longer claims an hourly window (errors are sent promptly)', () => {
    const mail = buildDigestEmail(tenant, [{ id: '1', clientInvoiceNumber: 'INV-1', errorCategory: 'GATEWAY_REJECTED', fieldAffected: 'gateway', errorMessage: 'Invalid TIN', sourceErp: 'qbo', createdAt: new Date() }]);
    expect(mail.text).not.toContain('last hour');
    expect(mail.html).not.toContain('once an hour');
  });
});

// Recipient chain: Settings override -> ERP company email -> hub users, skipping unreal addresses.
vi.mock('../../lib/prisma', () => ({ prisma: { user: { findMany: vi.fn() } } }));
vi.mock('../../services/erpContactEmail', async orig => ({ ...(await orig<any>()), getErpCompanyEmails: vi.fn() }));
vi.mock('../../services/emailVerify', async orig => {
  const real = await orig<any>();
  return { ...real, filterDeliverable: (emails: string[]) => real.filterDeliverable(emails, dns) };
});

describe('feedback recipient selection', () => {
  beforeEach(async () => {
    clearEmailCheckCache();
    const { prisma } = await import('../../lib/prisma');
    (prisma.user.findMany as any).mockResolvedValue([{ email: 'ops@acme.ng' }]);
  });

  it('uses the Settings override when it is real', async () => {
    const { getErpCompanyEmails } = await import('../../services/erpContactEmail');
    (getErpCompanyEmails as any).mockResolvedValue(['books@gmail.com']);
    const { resolveRecipientsDetailed } = await import('../../crons/errorDigest');
    const r = await resolveRecipientsDetailed('t1', 'finance@acme.ng');
    expect(r.source).toBe('settings');
    expect(r.recipients).toEqual(['finance@acme.ng']);
  });

  it('defaults to the ERP company email when there is no override', async () => {
    const { getErpCompanyEmails } = await import('../../services/erpContactEmail');
    (getErpCompanyEmails as any).mockResolvedValue(['books@gmail.com']);
    const { resolveRecipientsDetailed } = await import('../../crons/errorDigest');
    const r = await resolveRecipientsDetailed('t1', null);
    expect(r.source).toBe('erp');
    expect(r.recipients).toEqual(['books@gmail.com']);
  });

  it('skips an unreal ERP email and falls back to hub users', async () => {
    const { getErpCompanyEmails } = await import('../../services/erpContactEmail');
    (getErpCompanyEmails as any).mockResolvedValue(['noreply@example.com']);
    const { resolveRecipientsDetailed } = await import('../../crons/errorDigest');
    const r = await resolveRecipientsDetailed('t1', null);
    expect(r.source).toBe('hub_users');
    expect(r.recipients).toEqual(['ops@acme.ng']);
    expect(r.rejected.map(c => c.email)).toEqual(['noreply@example.com']);
  });
});
