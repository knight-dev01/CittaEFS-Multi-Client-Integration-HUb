/**
 * One paginated sync pipeline for every ERP.
 *
 * Connectors differ in how a page is fetched, which field is the stable source
 * key, and how a raw record becomes a hub invoice. Everything else — looping
 * pages, dedupe counting, per-record error isolation, last-sync bookkeeping and
 * the audit entry — is shared here.
 *
 * Queueing is deliberately not part of this pipeline: every connection feeds
 * the same invoice queue, and per-connection runs are observability only.
 */
import crypto from "crypto";
import type { SyncPage, SyncRecordError } from "./types";

interface SyncClient {
  invoice: { findFirst(args: any): Promise<{ id: string } | null> };
  integration: { updateMany(args: any): Promise<any> };
}

export interface PagedSyncOptions<TRecord, TCursor> {
  tenantId: string;
  /** Integration.sourceSystem value. */
  sourceSystem: string;
  platformLabel: string;
  auditAction: string;
  fetchPage: (cursor: TCursor | null) => Promise<SyncPage<TRecord, TCursor>>;
  /** Must match the business key the ingest function dedupes on. */
  dedupeKey: (record: TRecord) => string;
  ingest: (record: TRecord) => Promise<any>;
  /** Override the default Invoice lookup (used by tests). */
  isAlreadySynced?: (record: TRecord, key: string) => Promise<boolean>;
  maxPages?: number;
  onRecordError?: (args: { record: TRecord; key: string; error: Error }) => void;
  /** Write Integration.lastSyncAt when the run completes. Defaults to true. */
  markSyncedAt?: boolean;
  /** Write the shared CONNECTOR-style audit entry. Defaults to true. */
  writeAudit?: boolean;
  performedBy?: string;
  client?: SyncClient;
}

export interface PagedSyncResult {
  totalFound: number;
  newSynced: number;
  alreadySynced: number;
  processed: any[];
  errors: SyncRecordError[];
  pages: number;
}

async function clientOf(client?: SyncClient): Promise<SyncClient> {
  if (client) return client;
  const { getPrisma } = await import("../lib/prisma");
  return getPrisma() as unknown as SyncClient;
}

export async function runPagedSync<TRecord, TCursor>(
  options: PagedSyncOptions<TRecord, TCursor>,
): Promise<PagedSyncResult> {
  const result: PagedSyncResult = {
    totalFound: 0,
    newSynced: 0,
    alreadySynced: 0,
    processed: [],
    errors: [],
    pages: 0,
  };

  const alreadySynced =
    options.isAlreadySynced ??
    (async (_record: TRecord, key: string) => {
      const client = await clientOf(options.client);
      const existing = await client.invoice.findFirst({
        where: { tenantId: options.tenantId, clientInvoiceId: key },
        select: { id: true },
      });
      return Boolean(existing);
    });

  let cursor: TCursor | null = null;

  while (true) {
    const page = await options.fetchPage(cursor);
    const records = page.records ?? [];
    result.totalFound += records.length;
    result.pages += 1;

    for (const record of records) {
      const key = options.dedupeKey(record);
      try {
        const exists = await alreadySynced(record, key);
        const invoice = await options.ingest(record);
        if (exists) result.alreadySynced += 1;
        else result.newSynced += 1;
        result.processed.push(invoice);
      } catch (error: any) {
        const message = String(error?.message || error);
        result.errors.push({ key, message });
        options.onRecordError?.({ record, key, error: error instanceof Error ? error : new Error(message) });
      }
    }

    if (page.nextCursor === null || page.nextCursor === undefined) break;
    if (page.nextCursor === cursor) {
      throw new Error(
        `${options.platformLabel} pagination returned the same cursor twice; stopped to avoid an infinite loop.`,
      );
    }
    cursor = page.nextCursor;

    if (options.maxPages !== undefined && result.pages >= options.maxPages) break;
  }

  if (options.markSyncedAt !== false) {
    const client = await clientOf(options.client);
    await client.integration
      .updateMany({
        where: { tenantId: options.tenantId, sourceSystem: options.sourceSystem },
        data: { lastSyncAt: new Date() },
      })
      .catch(() => {});
  }

  if (options.writeAudit !== false) {
    const client = await clientOf(options.client);
    const { safeAuditLogCreate } = await import("../lib/serverHelpers");
    const detail = `${options.platformLabel} sync completed. Total found: ${result.totalFound}, New synced: ${result.newSynced}, Already synced: ${result.alreadySynced}${
      result.errors.length ? `, Skipped: ${result.errors.length}` : ""
    }`;
    await safeAuditLogCreate(client as any, {
      tenantId: options.tenantId,
      action: options.auditAction,
      entityType: "INTEGRATION",
      entityRef: options.sourceSystem,
      details: detail,
      sha256PayloadHash: crypto
        .createHash("sha256")
        .update(`${options.tenantId}:${Date.now()}`, "utf8")
        .digest("hex"),
      performedBy: options.performedBy || `${options.platformLabel} Sync`,
      rawJson: {
        sourceSystem: options.sourceSystem,
        pages: result.pages,
        errors: result.errors,
      },
    });
  }

  return result;
}
