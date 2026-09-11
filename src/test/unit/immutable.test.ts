import { describe, it, expect } from 'vitest';

describe('Gateway immutability — ERP owns edits', () => {
  it('PUT /api/invoices/:id is 403 in routes/invoices.ts (hub read-only)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/routes/invoices.ts', 'utf8');
    expect(src).toContain('Invoices are ERP-sourced and immutable in hub');
    expect(src).toContain('return res.status(403)');
  });

  it('POST /api/invoices restricted to qbo|odoo', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/routes/invoices.ts', 'utf8');
    expect(src).toContain('ERP-sourced (qbo/odoo)');
    expect(src).toContain('sourceErp && !["qbo","odoo"]');
  });

  it('Customers and Items POST/PUT/DELETE are 403', async () => {
    const fs = await import('fs');
    const c = fs.readFileSync('src/routes/customers.ts', 'utf8');
    const i = fs.readFileSync('src/routes/items.ts', 'utf8');
    expect(c).toContain('Customers are ERP-sourced and immutable');
    expect(i).toContain('Items are ERP-sourced and immutable');
  });

  it('Onboard ERP not Client — no Excel option', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/components/OnboardClientModal.tsx', 'utf8');
    expect(src).not.toContain("'Excel & CSV Import'");
    expect(src).toContain("'QuickBooks Online','Odoo ERP'");
  });
});
