import { Tenant, Invoice, CustomerProfile, ItemCodeMapping, ValidationErrorItem, AuditLog, QueueJob, SystemMetrics } from '../types';
import hsCodesRaw from './hsCodes.json';
import serviceCodesRaw from './serviceCodes.json';

export const INITIAL_TENANTS: Tenant[] = [];

// Official CittaEFS/NRS code catalogs — extracted from the bulk-invoice-upload
// template's Instructions sheet (the gateway's own source of truth). HS codes
// are bare numeric tariff codes (e.g. "8471.30"); Service codes are 4-digit
// ISIC Rev.4 codes (e.g. "6920"). Neither carries an "HS-"/"SRV-" prefix —
// the gateway rejects those as unrecognized codes.
export const CITTA_HS_CODES_REFERENCE: { code: string; name: string; type: 'HS_CODE'; defaultVat: number }[] =
  (hsCodesRaw as { code: string; name: string }[]).map((c) => ({ ...c, type: 'HS_CODE' as const, defaultVat: 7.5 }));

export const CITTA_SERVICE_CODES_REFERENCE: { code: string; name: string; type: 'SERVICE_CODE'; defaultVat: number }[] =
  (serviceCodesRaw as { code: string; name: string }[]).map((c) => ({ ...c, type: 'SERVICE_CODE' as const, defaultVat: 7.5 }));

const HS_CODE_SET = new Set(CITTA_HS_CODES_REFERENCE.map((c) => c.code));
const SERVICE_CODE_SET = new Set(CITTA_SERVICE_CODES_REFERENCE.map((c) => c.code));

/** Whether a code exists in the official CittaEFS HS or Service catalog. Handles legacy prefixed codes HS-8471.30 / SRV-6920 by stripping prefix before lookup. */
export function isValidCittaCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const bare = code.trim().replace(/^(HS|SRV)[-_]?/i, "");
  return HS_CODE_SET.has(code) || SERVICE_CODE_SET.has(code) || HS_CODE_SET.has(bare) || SERVICE_CODE_SET.has(bare);
}
export function normalizeCittaCode(code: string | null | undefined): string {
  if (!code) return "UNMAPPED";
  const bare = code.trim().replace(/^(HS|SRV)[-_]?/i, "");
  if (HS_CODE_SET.has(bare) || SERVICE_CODE_SET.has(bare)) return bare;
  if (HS_CODE_SET.has(code) || SERVICE_CODE_SET.has(code)) return code;
  return bare;
}

/**
 * Looks up a code's real classification by catalog membership rather than by
 * string prefix — real HS and Service codes are both bare numeric and are
 * NOT distinguishable by format alone (unlike the old fictional "HS-"/"SRV-"
 * prefixed scheme this replaces).
 */
export function getCittaCodeType(code: string | null | undefined): 'HS_CODE' | 'SERVICE_CODE' | null {
  if (!code) return null;
  const bare = code.trim().replace(/^(HS|SRV)[-_]?/i, "");
  if (HS_CODE_SET.has(code) || HS_CODE_SET.has(bare)) return 'HS_CODE';
  if (SERVICE_CODE_SET.has(code) || SERVICE_CODE_SET.has(bare)) return 'SERVICE_CODE';
  return null;
}

// The official catalog uses formal customs/ISIC terminology ("automatic data
// processing machines", not "laptop") — plain substring search on the name
// finds nothing for the everyday words people actually type. This maps common
// consumer terms to their real, verified codes so search behaves like people
// expect, without pretending the formal names say something they don't.
const SEARCH_ALIASES: Record<string, string[]> = {
  laptop: ['8471.30'], laptops: ['8471.30'], notebook: ['8471.30'], macbook: ['8471.30'],
  computer: ['8471.30', '8471.41', '8471.49'], computers: ['8471.30', '8471.41', '8471.49'],
  desktop: ['8471.41', '8471.49'], pc: ['8471.41', '8471.49'],
  monitor: ['8528.52', '8528.59', '8528.42', '8528.49'], monitors: ['8528.52', '8528.59'], screen: ['8528.52', '8528.59'], display: ['8528.52', '8528.59'],
  keyboard: ['8471.60'], keyboards: ['8471.60'], mouse: ['8471.60'],
  chair: ['9401.39', '9401.31', '9401.71', '9401.61'], chairs: ['9401.39', '9401.31'], seat: ['9401.39', '9401.31'],
  table: ['9403.10', '9403.30'], desk: ['9403.10', '9403.30'], furniture: ['9403.10', '9403.30'],
  clock: ['9105.91', '9105.21', '9105.11'], clocks: ['9105.91', '9105.21'],
  phone: ['8517.13', '8517.14', '8517.11', '8517.18'], telephone: ['8517.11', '8517.18'], smartphone: ['8517.13'],
  printer: ['8443.31', '8443.32'], printers: ['8443.31', '8443.32'],
  router: ['8517.62'], switch: ['8517.62'],
};

/**
 * Searches both catalogs by code, official name, and common-term alias — a
 * plain substring match on the formal name alone misses everyday search terms
 * like "laptop" or "chair" entirely.
 */
export function searchCittaCodes(query: string): { code: string; name: string; type: 'HS_CODE' | 'SERVICE_CODE'; defaultVat: number }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const aliasCodes = new Set(SEARCH_ALIASES[q] || []);
  const all = [...CITTA_HS_CODES_REFERENCE, ...CITTA_SERVICE_CODES_REFERENCE];
  const matches = all.filter(
    (c) => aliasCodes.has(c.code) || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
  );
  matches.sort((a, b) => Number(aliasCodes.has(b.code)) - Number(aliasCodes.has(a.code)));
  return matches;
}

export const INITIAL_ITEM_MAPPINGS: ItemCodeMapping[] = [];

export const INITIAL_CUSTOMERS: CustomerProfile[] = [];

export const INITIAL_INVOICES: Invoice[] = [];

export const INITIAL_VALIDATION_ERRORS: ValidationErrorItem[] = [];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [];

export const INITIAL_METRICS: SystemMetrics = {
  totalInvoicesProcessed: 0,
  nrsStampSuccessRate: 100.0,
  averageLatencyMs: 0,
  activeTenantsCount: 0,
  pendingValidationCount: 0,
  reconciliationCronStatus: 'HEALTHY',
  cittaGatewayStatus: 'ONLINE'
};
