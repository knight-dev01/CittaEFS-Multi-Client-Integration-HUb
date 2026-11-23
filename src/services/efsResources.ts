/**
 * CittaEFS's own configured code lists (public /api/resources/* endpoints,
 * cached 24h by cittaEfsClient). The API guide requires invoiceTypeCode,
 * taxCategoryId and hsOrServiceCode to be values configured there, so the
 * pre-flight and the code search use these lists whenever CittaEFS answers.
 * When it does not, callers keep working with the bundled reference data.
 */
import { cittaEfsClient } from "./cittaEfsClient";
import { setLiveCatalog } from "../lib/codeRetrieval";
import type { EfsCatalog } from "../lib/efsPreflight";

let lastGood: EfsCatalog | null = null;
let loadedAt = 0;
const RELOAD_MS = 60 * 60 * 1000; // the client caches the lists for 24h; rebuild our sets hourly

function percentOf(value: unknown): number | null {
  const n = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

export async function loadEfsCatalog(): Promise<EfsCatalog | null> {
  if (lastGood && Date.now() - loadedAt < RELOAD_MS) return lastGood;
  try {
    const [types, taxes, hs, services] = await Promise.all([
      cittaEfsClient.getResourceInvoiceTypes(),
      cittaEfsClient.getResourceTaxCategories(),
      cittaEfsClient.getResourceHsCodes(),
      cittaEfsClient.getResourceServiceCodes(),
    ]);
    const catalog: EfsCatalog = {
      invoiceTypes: new Set(types.map((t: any) => String(t.code ?? "").trim()).filter(Boolean)),
      taxCategories: new Map(
        taxes
          .map((t: any) => [String(t.code ?? "").trim().toUpperCase(), percentOf(t.percent)] as [string, number | null])
          .filter(([code]) => !!code),
      ),
      codes: new Set([
        ...hs.map((h: any) => String(h.hscode ?? h.code ?? "").trim()),
        ...services.map((s: any) => String(s.code ?? "").trim()),
      ].filter(Boolean)),
    };
    // An empty list means the endpoint answered oddly; do not validate against it.
    if (!catalog.invoiceTypes.size || !catalog.taxCategories.size || !catalog.codes.size) return lastGood;

    {
      setLiveCatalog([
        ...hs.map((h: any) => ({ code: String(h.hscode ?? h.code ?? "").trim(), name: String(h.description ?? ""), type: "HS_CODE" as const })),
        ...services.map((s: any) => ({ code: String(s.code ?? "").trim(), name: String(s.description ?? ""), type: "SERVICE_CODE" as const })),
      ].filter(e => e.code && e.name));
    }
    lastGood = catalog;
    loadedAt = Date.now();
    return catalog;
  } catch (error: any) {
    console.warn("[EFS resources] could not load CittaEFS code lists:", error?.message || error);
    return lastGood;
  }
}
