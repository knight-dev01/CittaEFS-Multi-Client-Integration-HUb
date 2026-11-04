/**
 * Per-connection ERP settings stored in TenantErp.config.
 *
 * The column is a JSON string shared by every ERP, so all readers go through
 * these helpers instead of calling JSON.parse directly. Two keys are owned by
 * the hub:
 *   mapping_config — tax rate → ERP tax code, product SKU → ERP product code
 *   health         — last probe result written by the health cron / Test button
 * Everything else already in the object is preserved on write.
 */

export interface ErpMappingConfig {
  /** ERP tax rate (e.g. "7.5") → ERP tax code (e.g. "STANDARD_VAT"). */
  taxRates: Record<string, string>;
  /** Hub client SKU → ERP product / item code. */
  products: Record<string, string>;
}

export interface ErpHealthMetadata {
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  latencyMs?: number;
  companyName?: string;
  authStatus?: "AUTHENTICATED" | "FAILED" | "UNKNOWN";
  consecutiveFailures?: number;
}

export function parseErpConfig(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanStringMap(input: unknown, maxKey = 120, maxValue = 200): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const k = String(key).trim();
    const v = String(value ?? "").trim();
    if (!k || !v) continue;
    if (k.length > maxKey || v.length > maxValue) continue;
    out[k] = v;
  }
  return out;
}

export function readMappingConfig(raw: string | null | undefined): ErpMappingConfig {
  const parsed = parseErpConfig(raw);
  const mapping = parsed.mapping_config;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return { taxRates: {}, products: {} };
  }
  return {
    taxRates: cleanStringMap((mapping as any).taxRates),
    products: cleanStringMap((mapping as any).products),
  };
}

export function normalizeMappingInput(input: unknown): ErpMappingConfig {
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as any) : {};
  return {
    taxRates: cleanStringMap(source.taxRates ?? source.tax_rates),
    products: cleanStringMap(source.products),
  };
}

export function withMappingConfig(
  raw: string | null | undefined,
  mapping: ErpMappingConfig,
): string {
  const parsed = parseErpConfig(raw);
  return JSON.stringify({
    ...parsed,
    mapping_config: {
      taxRates: cleanStringMap(mapping.taxRates),
      products: cleanStringMap(mapping.products),
    },
  });
}

export function readHealth(raw: string | null | undefined): ErpHealthMetadata {
  const parsed = parseErpConfig(raw);
  const health = parsed.health;
  if (!health || typeof health !== "object" || Array.isArray(health)) return {};
  const value = health as Record<string, unknown>;
  const auth = String(value.authStatus || "UNKNOWN");
  return {
    lastCheckedAt: value.lastCheckedAt ? String(value.lastCheckedAt) : undefined,
    lastSuccessAt: value.lastSuccessAt ? String(value.lastSuccessAt) : undefined,
    lastError: value.lastError ? String(value.lastError) : undefined,
    latencyMs: value.latencyMs !== undefined ? Number(value.latencyMs) : undefined,
    companyName: value.companyName ? String(value.companyName) : undefined,
    authStatus: auth === "AUTHENTICATED" || auth === "FAILED" ? auth : "UNKNOWN",
    consecutiveFailures: value.consecutiveFailures !== undefined
      ? Number(value.consecutiveFailures)
      : undefined,
  };
}

export function withHealth(
  raw: string | null | undefined,
  patch: ErpHealthMetadata,
): string {
  const parsed = parseErpConfig(raw);
  const merged = { ...readHealth(raw), ...patch };
  return JSON.stringify({ ...parsed, health: merged });
}

/**
 * ERP product code mapped to a hub SKU. Returns undefined when the connection
 * has no mapping for that SKU, so callers can keep the SKU untouched rather
 * than inventing a value.
 */
export function resolveErpProductCode(
  mapping: ErpMappingConfig,
  clientSku: string | null | undefined,
): string | undefined {
  const sku = String(clientSku ?? "").trim();
  if (!sku) return undefined;
  return mapping.products[sku];
}

/** ERP tax code mapped to a VAT rate. Accepts numeric or string input. */
export function resolveErpTaxCode(
  mapping: ErpMappingConfig,
  vatRate: number | string | null | undefined,
): string | undefined {
  if (vatRate === null || vatRate === undefined || vatRate === "") return undefined;
  const numeric = Number(vatRate);
  if (!Number.isFinite(numeric)) return undefined;
  const canonical = String(numeric);
  return mapping.taxRates[canonical] ?? mapping.taxRates[String(vatRate)];
}
