/**
 * Deterministic HS / service-code memory. A code a person confirmed for one
 * item is reused, without asking again, for:
 *   1. the same SKU (the Item dictionary, as before), and
 *   2. a different SKU whose description is the same once normalised, as long
 *      as every confirmed item with that description agrees on one code.
 * Nothing here guesses: it only repeats a confirmed decision.
 */
import { isValidCittaCode, normalizeCittaCode } from "../data/referenceData";

// Descriptions too vague to identify a product on their own.
const VAGUE = new Set([
  "item", "items", "product", "products", "service", "services", "goods", "misc",
  "miscellaneous", "other", "others", "sales", "sale", "invoice line", "line item",
  "odoo invoice line", "mapped via validation fix", "imported csv row", "general",
]);

export function normalizeDescription(text: string | null | undefined): string {
  return String(text || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ") // Odoo "[REF] Name" internal references
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b\d+\b/g, " ") // quantities, sizes and years vary per line
    .replace(/\s+/g, " ")
    .trim();
}

export function isDistinctiveDescription(normalised: string): boolean {
  return normalised.length >= 6 && !VAGUE.has(normalised) && /[a-z]{3,}/.test(normalised);
}

export interface MemoryItem {
  clientSku: string;
  name?: string | null;
  description?: string | null;
  hsOrServiceCode?: string | null;
}

/** Code for a line from the SKU mapping, else from an identical confirmed description. */
export function findRememberedCode(
  items: MemoryItem[],
  sku: string | null | undefined,
  description: string | null | undefined,
): { code: string; via: "SKU" | "DESCRIPTION" } | null {
  const bySku = sku ? items.find(m => m.clientSku === sku) : undefined;
  const skuCode = bySku?.hsOrServiceCode ? normalizeCittaCode(bySku.hsOrServiceCode) : "";
  if (skuCode && isValidCittaCode(skuCode)) return { code: skuCode, via: "SKU" };

  const key = normalizeDescription(description);
  if (!isDistinctiveDescription(key)) return null;
  const codes = new Set<string>();
  for (const item of items) {
    const code = item.hsOrServiceCode ? normalizeCittaCode(item.hsOrServiceCode) : "";
    if (!code || !isValidCittaCode(code)) continue;
    if (normalizeDescription(item.description) === key || normalizeDescription(item.name) === key) codes.add(code);
  }
  // Conflicting confirmed codes for the same wording: not safe to reuse.
  return codes.size === 1 ? { code: [...codes][0], via: "DESCRIPTION" } : null;
}
