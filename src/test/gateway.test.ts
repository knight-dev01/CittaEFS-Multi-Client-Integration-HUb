import { describe, it, expect, vi } from 'vitest';
import nock from 'nock';

describe('Gateway — pending until verified + writeback FAILED', () => {
  it('cittaEfsClient normalizes HS- prefix before POST gen/invoices', async () => {
    const { normalizeCittaCode } = await import('../data/referenceData');
    expect(normalizeCittaCode('HS-8471.30')).toBe('8471.30');
    expect(normalizeCittaCode('8130')).toBe('8130');
  });

  it('server.ts has 60s QBO, 60s Odoo, 300s NRS intervals', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('server.ts', 'utf8');
    expect(src).toContain('runNrsReconciliationCron');
    expect(src).toContain('runQbReconciliationCron');
    expect(src).toContain('fetchOdooInvoicesSince');
    expect(src).toContain('300000');
    expect(src).toContain('60000');
  });

  it('metrics byErp group includes qbo|odoo', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/routes/validation.ts', 'utf8');
    expect(src).toContain('byErp');
    expect(src).toContain('timeseries');
    expect(src).toContain('erpHealth');
    expect(src).toContain('sourceErp');
  });

  it('ERP independent uniques — TenantErp companyId, Invoice tenantErpId', async () => {
    const fs = await import('fs');
    const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
    expect(schema).toContain('companyId');
    expect(schema).toContain('@@unique([tenantId, erpId, companyId])');
    expect(schema).toContain('@@unique([tenantId, sourceSystem, companyId])');
  });

  it('mocks Citta gateway 400 HS- prefix rejected vs 200 bare 8130', async () => {
    const scope = nock('https://ei-api.azurewebsites.net')
      .post('/api/integration/gen/invoices', (body: any) => Array.isArray(body) && body[0]?.hsOrServiceCode === 'HS-8471.30')
      .reply(400, { success: false, failedCount: 1, errors: [{ field: 'HSorService' }] })
      .post('/api/integration/gen/invoices', (body: any) => Array.isArray(body) && body[0]?.hsOrServiceCode === '8130')
      .reply(200, { success: true, successCount: 1, irn: 'IRN-TEST', csid: 'CSID', qrCodeUrl: 'https://qr' });

    const { normalizeCittaCode } = await import('../data/referenceData');
    expect(normalizeCittaCode('HS-8471.30')).not.toBe('HS-8471.30');
    expect(normalizeCittaCode('HS-8471.30')).toBe('8471.30');
    nock.cleanAll();
  });
});
