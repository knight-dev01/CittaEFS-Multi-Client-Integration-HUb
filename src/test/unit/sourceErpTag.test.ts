import { describe, it, expect } from 'vitest';
import { sourceErpLabel, withSourceTag, hubInvoiceIdFrom } from '../../lib/sourceErpTag';

describe('source ERP tag for CittaEFS', () => {
  it('labels each source', () => {
    expect(sourceErpLabel('qbo')).toEqual({ system: 'QuickBooks Online', code: 'QBO' });
    expect(sourceErpLabel('odoo')).toEqual({ system: 'Odoo', code: 'ODOO' });
    expect(sourceErpLabel(null)).toEqual({ system: 'Hub API', code: 'API' });
    expect(sourceErpLabel('sage')).toEqual({ system: 'sage', code: 'SAGE' });
  });

  it('adds the tag to existing metadata and custom fields without dropping them', () => {
    const tagged = withSourceTag(
      { metadata: { BranchCode: 'LAGOS-001' }, customFields: { Department: 'IT' } },
      { hubInvoiceId: 'hub-1', sourceErp: 'qbo', sourceInvoiceNumber: 'INV-1001' },
    );
    expect(tagged.metadata).toEqual({
      BranchCode: 'LAGOS-001', SourceSystem: 'QuickBooks Online', SourceInvoiceNumber: 'INV-1001', HubInvoiceId: 'hub-1',
    });
    expect(tagged.customFields).toEqual({ Department: 'IT', SourceErp: 'QBO' });
  });

  it('reads the hub id back from echoed metadata, any key case', () => {
    expect(hubInvoiceIdFrom({ metadata: { HubInvoiceId: 'hub-1' } })).toBe('hub-1');
    expect(hubInvoiceIdFrom({ Metadata: { hubinvoiceid: 'hub-2' } })).toBe('hub-2');
    expect(hubInvoiceIdFrom({ metadata: { CustomField1: 'x' } })).toBeNull();
    expect(hubInvoiceIdFrom(null)).toBeNull();
  });
});
