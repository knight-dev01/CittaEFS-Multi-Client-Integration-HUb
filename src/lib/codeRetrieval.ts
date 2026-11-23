/**
 * Local candidate retrieval for HS / service codes: BM25 over the official
 * CittaEFS catalog (5,600+ HS codes, 400+ service codes) plus examples people
 * have already confirmed. It only ranks codes that exist in the catalog, so
 * nothing downstream can submit a code that does not exist. No network calls.
 */
import {
  CITTA_HS_CODES_REFERENCE,
  CITTA_SERVICE_CODES_REFERENCE,
  isValidCittaCode,
  normalizeCittaCode,
  getCittaCodeType,
} from "../data/referenceData";

export interface CatalogEntry {
  code: string;
  name: string;
  type: "HS_CODE" | "SERVICE_CODE";
}

export interface LearnedExample {
  description: string;
  code: string;
}

export interface RetrievedCandidate extends CatalogEntry {
  score: number;
  /** Confirmed items with similar wording that used this code. */
  learnedMatches: number;
}

const STOP = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "with", "by", "or", "other", "others",
  "not", "nes", "elsewhere", "specified", "including", "excluding", "whether", "than", "its",
  "per", "pcs", "pc", "unit", "units", "item", "items", "product", "products", "x", "no",
]);

// Everyday invoice wording -> catalog wording.
const SYNONYMS: Record<string, string[]> = {
  laptop: ["portable", "automatic", "data", "processing", "machines"],
  laptops: ["portable", "automatic", "data", "processing", "machines"],
  computer: ["automatic", "data", "processing", "machines"],
  pc: ["automatic", "data", "processing"],
  phone: ["telephone", "cellular", "networks"],
  smartphone: ["telephone", "cellular", "networks"],
  tv: ["television", "reception"],
  fridge: ["refrigerators"],
  ac: ["air", "conditioning"],
  aircon: ["air", "conditioning"],
  consulting: ["consultancy", "management", "activities"],
  consultancy: ["consultancy", "management"],
  software: ["computer", "programming", "publishing"],
  saas: ["computer", "programming", "software", "publishing"],
  repair: ["repair", "maintenance"],
  cleaning: ["cleaning", "buildings"],
  transport: ["transport", "freight"],
  delivery: ["freight", "transport", "courier"],
  training: ["education", "training"],
  legal: ["legal", "activities"],
  audit: ["accounting", "auditing"],
  accounting: ["accounting", "bookkeeping"],
  rent: ["renting", "leasing"],
  rental: ["renting", "leasing"],
  security: ["security", "investigation"],
  advert: ["advertising"],
  ads: ["advertising"],
  marketing: ["advertising", "market", "research"],
  gardening: ["landscape", "service"],
  catering: ["food", "service", "activities"],
  printing: ["printing"],
  diesel: ["gas", "oils", "petroleum"],
  fuel: ["petroleum", "oils", "fuels"],
};

export function tokenize(text: string): string[] {
  const words = String(text || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
  const out: string[] = [];
  for (const w of words) {
    out.push(stem(w));
    for (const s of SYNONYMS[w] || []) out.push(stem(s));
  }
  return out;
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("es") && !word.endsWith("ses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

interface Doc {
  entry: CatalogEntry;
  tf: Map<string, number>;
  length: number;
}

export class CodeIndex {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLength = 1;
  private byCode = new Map<string, CatalogEntry>();

  constructor(entries: CatalogEntry[]) {
    let total = 0;
    for (const entry of entries) {
      const tokens = tokenize(entry.name);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      this.docs.push({ entry, tf, length: tokens.length || 1 });
      this.byCode.set(entry.code, entry);
      total += tokens.length;
    }
    this.avgLength = this.docs.length ? total / this.docs.length : 1;
  }

  entry(code: string): CatalogEntry | undefined {
    return this.byCode.get(code);
  }

  /** BM25 (k1 = 1.2, b = 0.75). */
  search(queryTokens: string[], limit: number): { entry: CatalogEntry; score: number }[] {
    const n = this.docs.length;
    const terms = [...new Set(queryTokens)];
    const scored: { entry: CatalogEntry; score: number }[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const t of terms) {
        const f = doc.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) || 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += idf * ((f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * doc.length) / this.avgLength)));
      }
      if (score > 0) scored.push({ entry: doc.entry, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

let catalogIndex: CodeIndex | null = null;

/** Replaces the bundled catalog with CittaEFS's live configured codes. */
export function setLiveCatalog(entries: CatalogEntry[]): void {
  if (entries.length) catalogIndex = new CodeIndex(entries);
}

export function getCatalogIndex(): CodeIndex {
  if (!catalogIndex) {
    catalogIndex = new CodeIndex([
      ...CITTA_HS_CODES_REFERENCE.map(c => ({ code: c.code, name: c.name, type: "HS_CODE" as const })),
      ...CITTA_SERVICE_CODES_REFERENCE.map(c => ({ code: c.code, name: c.name, type: "SERVICE_CODE" as const })),
    ]);
  }
  return catalogIndex;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Top catalog candidates for an invoice line. Confirmed examples with similar
 * wording (k-nearest neighbours by token overlap) boost the codes they used.
 */
export function retrieveCandidates(
  text: string,
  learned: LearnedExample[],
  limit = 12,
  index: CodeIndex = getCatalogIndex(),
): RetrievedCandidate[] {
  const queryTokens = tokenize(text);
  if (!queryTokens.length) return [];
  const query = new Set(queryTokens);

  const scores = new Map<string, { score: number; learnedMatches: number }>();
  for (const hit of index.search(queryTokens, limit * 3)) {
    scores.set(hit.entry.code, { score: hit.score, learnedMatches: 0 });
  }

  const neighbours = learned
    .map(ex => ({ ex, sim: jaccard(query, new Set(tokenize(ex.description))) }))
    .filter(n => n.sim >= 0.34)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5);
  const topCatalog = Math.max(1, ...[...scores.values()].map(s => s.score));
  for (const { ex, sim } of neighbours) {
    const code = normalizeCittaCode(ex.code);
    if (!isValidCittaCode(code) || !index.entry(code)) continue;
    const current = scores.get(code) || { score: 0, learnedMatches: 0 };
    current.score += topCatalog * sim * 1.5;
    current.learnedMatches += 1;
    scores.set(code, current);
  }

  return [...scores.entries()]
    .map(([code, s]) => {
      const entry = index.entry(code)!;
      return { ...entry, type: (getCittaCodeType(code) || entry.type) as CatalogEntry["type"], score: s.score, learnedMatches: s.learnedMatches };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
