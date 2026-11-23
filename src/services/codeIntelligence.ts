/**
 * Code intelligence: automatic HS / service-code suggestions for invoice lines
 * the hub could not classify.
 *
 *   1. Memory (deterministic, applied without asking): same SKU, or the same
 *      wording as an item a person already classified (src/lib/codeMemory.ts).
 *   2. Retrieval: BM25 over the official catalog + confirmed examples
 *      (src/lib/codeRetrieval.ts). Local, no network.
 *   3. Model re-ranking (optional, AI_PROVIDER): picks from the retrieved
 *      candidates only, with a confidence and a reason.
 *
 * Suggestions are computed in the background for every open MISSING_HS_CODE
 * error. A new code is always confirmed by a person (one click); confirming
 * saves it to the Item dictionary, so that SKU and wording never ask again.
 */
import { prisma } from "../lib/prisma";
import { isValidCittaCode, normalizeCittaCode } from "../data/referenceData";
import { QuickBooksAdapter, OdooAdapter } from "../adapters/connectorAdapters";
import { normalizeDescription, isDistinctiveDescription } from "../lib/codeMemory";
import { retrieveCandidates, type LearnedExample, type RetrievedCandidate } from "../lib/codeRetrieval";
import { rankCandidates, getAiProvider, type RankResult } from "./aiCodeRanker";

export interface SuggestedCode {
  code: string;
  name: string;
  type: "HS_CODE" | "SERVICE_CODE";
  confidence: number; // 0..1
  reason: string;
  source: "MODEL" | "HISTORY" | "CATALOG";
}

export interface LineSuggestion {
  sku: string | null;
  description: string;
  descriptionKey: string;
  candidates: SuggestedCode[];
}

export interface UnclassifiedLine {
  sku: string | null;
  description: string;
  unitPrice: number | null;
}

/** The invoice lines behind a MISSING_HS_CODE error that still lack a valid code. */
export function extractUnclassifiedLines(error: {
  rawPayloadSample: string;
  sourceErp: string | null;
  errorMessage: string;
}): UnclassifiedLine[] {
  let raw: any = null;
  try { raw = JSON.parse(error.rawPayloadSample); } catch { return []; }
  if (!raw) return [];

  let lines: any[] = [];
  if (error.sourceErp === "odoo") {
    try { lines = new OdooAdapter().transform(raw).lineItems; } catch {}
  } else if (error.sourceErp === "qbo") {
    try { lines = new QuickBooksAdapter().transform(raw).lineItems; } catch {}
  }
  if (!lines.length && Array.isArray(raw.lineItems)) {
    lines = raw.lineItems.map((li: any) => ({ clientSku: li.itemCode || li.clientSku, description: li.description, hsOrServiceCode: li.hsOrServiceCode, unitPrice: li.unitPrice }));
  }

  const invalid = lines.filter(li => !isValidCittaCode(normalizeCittaCode(li.hsOrServiceCode)));
  const named = error.errorMessage.match(/for (.+?)\)/)?.[1]?.trim().toLowerCase();
  const narrowed = named ? invalid.filter(li => String(li.clientSku || "").toLowerCase() === named) : [];
  const chosen = narrowed.length ? narrowed : invalid;

  const seen = new Set<string>();
  const out: UnclassifiedLine[] = [];
  for (const li of chosen) {
    const description = String(li.description || li.clientSku || "").trim();
    const key = `${li.clientSku || ""}|${normalizeDescription(description)}`;
    if (!description || seen.has(key)) continue;
    seen.add(key);
    out.push({ sku: li.clientSku || null, description, unitPrice: Number(li.unitPrice) || null });
  }
  return out.slice(0, 10);
}

// Confirmed examples, all workspaces: wording -> code. Refreshed every 5 minutes.
let learnedCache: { at: number; examples: LearnedExample[] } | null = null;
async function getLearnedExamples(): Promise<LearnedExample[]> {
  if (learnedCache && Date.now() - learnedCache.at < 5 * 60 * 1000) return learnedCache.examples;
  const items = await prisma.item.findMany({
    select: { description: true, name: true, hsOrServiceCode: true },
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });
  const examples: LearnedExample[] = [];
  for (const item of items) {
    const code = normalizeCittaCode(item.hsOrServiceCode);
    if (!isValidCittaCode(code)) continue;
    const text = [item.name, item.description].filter(Boolean).join(" ");
    if (isDistinctiveDescription(normalizeDescription(text))) examples.push({ description: text, code });
  }
  learnedCache = { at: Date.now(), examples };
  return examples;
}

/** Local-only confidence: share of the top score, raised when confirmed history agrees. */
function localConfidence(candidate: RetrievedCandidate, top: number): number {
  const share = top > 0 ? candidate.score / top : 0;
  const base = candidate.learnedMatches > 0 ? 0.55 + 0.1 * Math.min(candidate.learnedMatches, 3) : 0.45 * share;
  return Number(Math.min(0.85, base).toFixed(2));
}

function localReason(candidate: RetrievedCandidate): string {
  return candidate.learnedMatches > 0
    ? `Used for ${candidate.learnedMatches} similar item(s) your team already confirmed.`
    : `Closest wording in the official code list.`;
}

export async function suggestForLine(
  line: UnclassifiedLine,
  opts: { sourceErp?: string | null; learned?: LearnedExample[] } = {},
): Promise<{ suggestion: LineSuggestion; rank: RankResult | null }> {
  const learned = opts.learned ?? (await getLearnedExamples());
  const text = [line.description, line.sku].filter(Boolean).join(" ");
  const retrieved = retrieveCandidates(text, learned, 12);
  const top = retrieved[0]?.score || 0;
  const byCode = new Map(retrieved.map(c => [c.code, c]));

  let rank: RankResult | null = null;
  const candidates: SuggestedCode[] = [];
  if (retrieved.length && getAiProvider() !== "none") {
    try {
      rank = await rankCandidates({ description: line.description, sku: line.sku, sourceErp: opts.sourceErp, unitPrice: line.unitPrice }, retrieved);
      for (const pick of rank.picks) {
        const c = byCode.get(pick.code)!;
        candidates.push({ code: c.code, name: c.name, type: c.type, confidence: Number(pick.confidence.toFixed(2)), reason: pick.reason, source: "MODEL" });
      }
    } catch (error: any) {
      // The model is optional: local candidates below still give the operator a choice.
      console.warn("[CodeIntelligence] model ranking failed:", error?.message || error);
    }
  }
  for (const c of retrieved) {
    if (candidates.length >= 3) break;
    if (candidates.some(x => x.code === c.code)) continue;
    candidates.push({
      code: c.code, name: c.name, type: c.type,
      confidence: rank?.picks.length ? Math.min(localConfidence(c, top), 0.3) : localConfidence(c, top),
      reason: localReason(c),
      source: c.learnedMatches > 0 ? "HISTORY" : "CATALOG",
    });
  }

  return {
    suggestion: { sku: line.sku, description: line.description, descriptionKey: normalizeDescription(line.description), candidates },
    rank,
  };
}

/** Computes and stores suggestions for one validation error (no-op when already stored). */
export async function ensureSuggestions(validationErrorId: string, force = false) {
  const existing = await prisma.codeSuggestion.findUnique({ where: { validationErrorId } });
  if (existing && !force) return existing;
  const error = await prisma.validationError.findUnique({ where: { id: validationErrorId } });
  if (!error || error.errorCategory !== "MISSING_HS_CODE") return null;

  const learned = await getLearnedExamples();
  const lines = extractUnclassifiedLines(error);
  const results = [];
  let provider = "none";
  let model: string | null = null;
  for (const line of lines) {
    const { suggestion, rank } = await suggestForLine(line, { sourceErp: error.sourceErp, learned });
    results.push(suggestion);
    if (rank && rank.provider !== "none") { provider = rank.provider; model = rank.model; }
  }

  const data = { tenantId: error.tenantId, linesJson: JSON.stringify(results), provider, model };
  return prisma.codeSuggestion.upsert({
    where: { validationErrorId },
    create: { validationErrorId, ...data },
    update: { ...data, status: "OPEN", acceptedCode: null },
  });
}

export async function markSuggestionAccepted(validationErrorId: string, code: string): Promise<void> {
  await prisma.codeSuggestion.updateMany({
    where: { validationErrorId },
    data: { status: "ACCEPTED", acceptedCode: code },
  });
  learnedCache = null; // the new confirmation is a learned example from now on
}

/** Background sweep: suggestions for open MISSING_HS_CODE errors that have none yet. */
export async function runSuggestionSweep(limit = 20): Promise<{ computed: number }> {
  const open = await prisma.validationError.findMany({
    where: { status: "OPEN", errorCategory: "MISSING_HS_CODE" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (!open.length) return { computed: 0 };
  const done = await prisma.codeSuggestion.findMany({
    where: { validationErrorId: { in: open.map(o => o.id) } },
    select: { validationErrorId: true },
  });
  const have = new Set(done.map(d => d.validationErrorId));
  let computed = 0;
  for (const { id } of open) {
    if (have.has(id)) continue;
    if (computed >= limit) break;
    try {
      await ensureSuggestions(id);
      computed++;
    } catch (error: any) {
      console.warn(`[CodeIntelligence] suggestions for ${id} failed:`, error?.message || error);
    }
  }
  return { computed };
}

export function parseLines(row: { linesJson: string } | null): LineSuggestion[] {
  if (!row) return [];
  try { return JSON.parse(row.linesJson); } catch { return []; }
}
