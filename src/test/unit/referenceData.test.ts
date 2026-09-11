import { describe, it, expect } from 'vitest';
import { isValidCittaCode, normalizeCittaCode, getCittaCodeType, searchCittaCodes } from '../../data/referenceData';

describe('referenceData — HS/Service gateway bare codes', () => {
  it('accepts bare 8471.30 and rejects prefixed HS-8471.30 via isValid but normalizes', () => {
    expect(isValidCittaCode('8471.30')).toBe(true);
    expect(isValidCittaCode('HS-8471.30')).toBe(true); // stripped
    expect(isValidCittaCode('SRV-6209')).toBe(true);
    expect(normalizeCittaCode('HS-8471.30')).toBe('8471.30');
    expect(normalizeCittaCode('SRV-6209')).toBe('6209');
  });

  it('8130 landscape service is valid SERVICE_CODE', () => {
    expect(isValidCittaCode('8130')).toBe(true);
    expect(getCittaCodeType('8130')).toBe('SERVICE_CODE');
    expect(getCittaCodeType('HS-8130')).toBe('SERVICE_CODE');
  });

  it('8471.30 is HS_CODE even with prefix', () => {
    expect(getCittaCodeType('8471.30')).toBe('HS_CODE');
    expect(getCittaCodeType('HS-8471.30')).toBe('HS_CODE');
  });

  it('UNMAPPED and empty are invalid', () => {
    expect(isValidCittaCode('UNMAPPED')).toBe(false);
    expect(isValidCittaCode('')).toBe(false);
    expect(isValidCittaCode(null as any)).toBe(false);
    expect(normalizeCittaCode('UNMAPPED')).toBe('UNMAPPED');
  });

  it('searchCittaCodes alias laptop → 8471.30', () => {
    const res = searchCittaCodes('laptop');
    expect(res.some(r => r.code === '8471.30')).toBe(true);
  });
});
