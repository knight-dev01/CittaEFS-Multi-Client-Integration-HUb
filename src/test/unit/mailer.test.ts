import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import nock from 'nock';
import { parseMailFrom, isMailConfigured, sendMail } from '../../services/mailer';

const KEYS = ['BREVO_API_KEY', 'MAIL_FROM', 'MAIL_BCC', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));

beforeEach(() => { for (const k of KEYS) delete process.env[k]; nock.cleanAll(); });
afterAll(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } nock.cleanAll(); });

describe('mailer', () => {
  it('parses MAIL_FROM', () => {
    expect(parseMailFrom('CittaEFS <a@gmail.com>')).toEqual({ name: 'CittaEFS', email: 'a@gmail.com' });
    expect(parseMailFrom('a@gmail.com')).toEqual({ email: 'a@gmail.com' });
  });

  it('is configured by MAIL_FROM plus Brevo key or SMTP settings', () => {
    expect(isMailConfigured()).toBe(false);
    process.env.MAIL_FROM = 'a@gmail.com';
    expect(isMailConfigured()).toBe(false);
    process.env.BREVO_API_KEY = 'k';
    expect(isMailConfigured()).toBe(true);
  });

  it('sends through the Brevo HTTPS API when BREVO_API_KEY is set', async () => {
    process.env.MAIL_FROM = 'CittaEFS <a@gmail.com>';
    process.env.BREVO_API_KEY = 'key-1';
    process.env.MAIL_BCC = 'ops@gmail.com';
    let body: any;
    const scope = nock('https://api.brevo.com', { reqheaders: { 'api-key': 'key-1' } })
      .post('/v3/smtp/email', b => { body = b; return true; })
      .reply(201, { messageId: '<m1@brevo>' });
    const r = await sendMail({ to: ['x@gmail.com'], subject: 'S', text: 'T', html: '<p>H</p>' });
    expect(scope.isDone()).toBe(true);
    expect(r.messageId).toBe('<m1@brevo>');
    expect(body.sender).toEqual({ name: 'CittaEFS', email: 'a@gmail.com' });
    expect(body.to).toEqual([{ email: 'x@gmail.com' }]);
    expect(body.bcc).toEqual([{ email: 'ops@gmail.com' }]);
  });

  it('surfaces Brevo errors (e.g. unverified sender)', async () => {
    process.env.MAIL_FROM = 'a@gmail.com';
    process.env.BREVO_API_KEY = 'k';
    nock('https://api.brevo.com').post('/v3/smtp/email').reply(400, { code: 'invalid_parameter', message: 'Sender not valid' });
    await expect(sendMail({ to: ['x@gmail.com'], subject: 'S', text: 'T', html: 'H' })).rejects.toThrow(/Brevo rejected the email \(400\): Sender not valid/);
  });
});
