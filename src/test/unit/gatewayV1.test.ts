import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { invoiceIngestionSchema } from '../../schemas/invoice.schema';
import { signWebhookPayload, verifyWebhookSignature } from '../../services/merchantWebhook';
import { openApiV1Spec } from '../../config/openApiV1';

const gatewaySrc = fs.readFileSync('src/routes/gateway.ts', 'utf8');
const serverSrc = fs.readFileSync('server.ts', 'utf8');

describe('Interswitch-style v1 gateway facade', () => {
  it('registers merchant, token, channel and transaction routes', () => {
    for (const route of [
      '/api/v1/health',
      '/api/v1/channels',
      '/api/v1/auth/token',
      '/api/v1/merchants/onboard',
      '/api/v1/transactions/initialize',
      '/api/v1/transactions/status/:transactionRef',
      '/api/v1/merchants/:merchantCode/transactions',
      '/api/v1/transactions/refund',
    ]) {
      expect(gatewaySrc).toContain(route);
    }
  });

  it('delegates to the internal standard schema (never bypasses it)', () => {
    expect(gatewaySrc).toContain('invoiceIngestionSchema.parse');
    expect(gatewaySrc).toContain("invoiceQueue.add(\"signInvoice\"");
  });

  it('returns Interswitch response codes 00 approved / 09 pending / 11 rejected', () => {
    expect(gatewaySrc).toContain('"00"');
    expect(gatewaySrc).toContain('"09"');
    expect(gatewaySrc).toContain('"11"');
    expect(gatewaySrc).toContain('ResponseCode');
    expect(gatewaySrc).toContain('transactionRef');
  });

  it('exposes ERP sources as switch channels qbo|odoo|api|file', () => {
    expect(gatewaySrc).toContain('"qbo"');
    expect(gatewaySrc).toContain('"odoo"');
    expect(gatewaySrc).toContain('"api"');
    expect(gatewaySrc).toContain('"file"');
  });

  it('issues 8h Bearer merchant tokens and onboards in test mode', () => {
    expect(gatewaySrc).toContain('access_token');
    expect(gatewaySrc).toContain('merchantCode');
    expect(gatewaySrc).toContain('expiresIn');
    expect(gatewaySrc).toContain('"8h"');
    expect(gatewaySrc).toContain('mode');
  });

  it('refund path creates a CREDIT_NOTE linked to the original IRN', () => {
    expect(gatewaySrc).toContain('CREDIT_NOTE');
    expect(gatewaySrc).toContain('originalIrn');
  });

  it('server mounts the gateway router and exempts v1 + hub/v1 from JWT session gate', () => {
    expect(serverSrc).toContain('gatewayRouter');
    expect(serverSrc).toContain('/api/v1/');
    expect(serverSrc).toContain('/api/hub/v1/');
  });

  it('Interswitch-mapped payload still passes the internal standard schema', () => {    const parsed: any = invoiceIngestionSchema.parse({
      tenantId: 'tenant_qbo_smb',
      clientInvoiceNumber: 'ORD12345',
      issueDate: '2026-09-10',
      customerCode: 'MX228251',
      customerName: 'Acme',
      customerTin: '12345678901234',
      lineItems: [
        { itemCode: 'SKU1', description: 'Service', quantity: 2, unitPrice: 100, hsOrServiceCode: '8130', vatRate: 7.5 },
      ],
    });
    expect(parsed.grandTotal).toBe(215);
    expect(parsed.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Phase 2 — signed webhooks + API contract', () => {
  it('registers webhook management, retry, verify and openapi routes', () => {
    for (const route of [
      '/api/v1/merchants/:merchantCode/webhook',
      '/api/v1/webhooks/retry/:transactionRef',
      '/api/v1/webhooks/verify',
      '/api/v1/openapi.json',
    ]) {
      expect(gatewaySrc).toContain(route);
    }
  });

  it('persists per-transaction callbackUrl on the invoice row', () => {
    expect(gatewaySrc).toContain('callbackUrl');
    expect(gatewaySrc).toContain('webhookUrl');
  });

  it('HMAC-SHA256 sign/verify round-trips and rejects tampered bodies', () => {
    const body = JSON.stringify({ event: 'invoice.authorized', transactionRef: 'ORD12345' });
    const sig = signWebhookPayload(body, 'secret-key');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyWebhookSignature(body, sig, 'secret-key')).toBe(true);
    expect(verifyWebhookSignature(body + ' ', sig, 'secret-key')).toBe(false);
    expect(verifyWebhookSignature(body, sig, 'other-key')).toBe(false);
  });

  it('worker notifies merchant webhook on authorized + rejected paths', () => {
    const workerSrc = fs.readFileSync('src/workers/invoiceWorker.ts', 'utf8');
    expect(workerSrc).toContain('dispatchMerchantWebhook');
    expect(workerSrc).toContain("'invoice.authorized'");
    expect(workerSrc).toContain("'invoice.rejected'");
  });

  it('NRS reconciliation notifies merchant webhook on archive recovery', () => {
    const cronSrc = fs.readFileSync('src/crons/reconciliation.ts', 'utf8');
    expect(cronSrc).toContain('dispatchMerchantWebhook');
  });

  it('openapi contract covers every v1 route', () => {
    const paths = Object.keys((openApiV1Spec as any).paths);
    for (const p of [
      '/health',
      '/channels',
      '/auth/token',
      '/merchants/onboard',
      '/transactions/initialize',
      '/transactions/status/{transactionRef}',
      '/merchants/{merchantCode}/transactions',
      '/transactions/refund',
      '/merchants/{merchantCode}/webhook',
      '/webhooks/retry/{transactionRef}',
      '/webhooks/verify',
      '/openapi.json',
    ]) {
      expect(paths).toContain(p);
    }
  });
});
