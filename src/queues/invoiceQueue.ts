import { ValidatedInvoiceIngestion } from '../schemas/invoice.schema';
import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';

// BullMQ / Redis — real distributed queue when REDIS_URL is set, otherwise DB-backed queue
let bullMqQueue: any = null;
let bullMqEnabled = false;
let bullMqInitPromise: Promise<any> | null = null;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  if (url) return url;
  const host = process.env.REDIS_HOST?.trim();
  if (host) {
    const port = process.env.REDIS_PORT?.trim() || '6379';
    const pass = process.env.REDIS_PASSWORD?.trim();
    const user = process.env.REDIS_USERNAME?.trim();
    if (pass) {
      const auth = user ? `${user}:${pass}` : `:${pass}`;
      return `redis://${auth}@${host}:${port}`;
    }
    return `redis://${host}:${port}`;
  }
  return null;
}

async function initBullMq(): Promise<any> {
  if (bullMqInitPromise) return bullMqInitPromise;
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;
  bullMqInitPromise = (async () => {
    try {
      const { Queue } = await import('bullmq');
      const IORedis = (await import('ioredis')).default as any;
      const connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
      });
      connection.on('error', (err: any) => console.warn('[BullMQ] Redis error, using DB queue:', err.message));
      bullMqQueue = new Queue('citta-invoice-queue', {
        connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 500 },
        },
      });
      // Test connection
      await bullMqQueue.waitUntilReady().catch(() => {});
      bullMqEnabled = true;
      console.log(`[BullMQ] Enabled — Redis ${redisUrl.replace(/\/\/.*@/, '//***@')} — queue citta-invoice-queue`);
      return bullMqQueue;
    } catch (e: any) {
      console.warn('[BullMQ] Init failed, DB queue will be used:', e.message);
      bullMqEnabled = false;
      return null;
    }
  })();
  return bullMqInitPromise;
}
// Kick off async init (non-blocking)
initBullMq().catch(() => {});

// The queued payload always carries the DB Invoice row's primary key (dbInvoiceId)
export type QueueablePayload = ValidatedInvoiceIngestion & { dbInvoiceId: string };

export interface QueueJob<T> {
  id: string;
  tenantId: string;
  data: T;
  attempts: number;
  maxRetries: number;
  backoffMs: number[];
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DLQ';
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
}

function getPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
}

// DB-backed queue with in-memory cache for low latency + persistence across restarts
class InvoiceQueueManager {
  private queue: QueueJob<QueueablePayload>[] = [];
  private dlq: QueueJob<QueueablePayload>[] = [];
  private hydrated = false;

  private mapDbRow(row: any): QueueJob<QueueablePayload> {
    const payload = JSON.parse(row.payload);
    return {
      id: row.id,
      tenantId: row.tenantId,
      data: payload,
      attempts: row.attempts,
      maxRetries: row.maxRetries,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
      status: row.status as any,
      lastError: row.lastError || undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      nextAttemptAt: row.nextAttemptAt instanceof Date ? row.nextAttemptAt.toISOString() : row.nextAttemptAt,
    };
  }

  private async hydrateIfNeeded() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const prisma = getPrisma();
      const rows = await prisma.queueJob.findMany({
        where: { status: { in: ['QUEUED', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      for (const r of rows) {
        const job = this.mapDbRow(r);
        if (!this.queue.find(j => j.id === job.id)) this.queue.push(job);
      }
      const dlqRows = await prisma.queueJob.findMany({ where: { status: 'DLQ' }, take: 200 });
      for (const r of dlqRows) {
        const job = this.mapDbRow(r);
        if (!this.dlq.find(j => j.id === job.id)) this.dlq.push(job);
      }
      await prisma.$disconnect().catch(()=>{});
    } catch (e) {
      console.warn('[Queue] Hydrate failed, using memory only:', (e as any)?.message);
    }
  }

  public async add(
    jobName: string,
    payload: QueueablePayload,
    options: { attempts?: number; backoff?: { type: string; delay: number } } = {}
  ): Promise<QueueJob<QueueablePayload>> {
    const job: QueueJob<QueueablePayload> = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId: payload.tenantId,
      data: payload,
      attempts: 0,
      maxRetries: options.attempts || 5,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString()
    };
    this.queue.push(job);
    // Persist to DB (always — DB is audit trail + backup)
    try {
      const prisma = getPrisma();
      await prisma.queueJob.create({
        data: {
          id: job.id,
          tenantId: job.tenantId,
          jobName,
          payload: JSON.stringify(payload),
          attempts: job.attempts,
          maxRetries: job.maxRetries,
          status: job.status,
          nextAttemptAt: new Date(job.nextAttemptAt),
        }
      });
      await prisma.$disconnect().catch(()=>{});
    } catch (e) {
      console.warn('[Queue] DB persist failed for job', job.id, (e as any)?.message);
    }
    // If BullMQ is enabled, also push to Redis for distributed workers
    try {
      const q = await initBullMq();
      if (q && bullMqEnabled) {
        await q.add(jobName, payload, {
          jobId: job.id,
          attempts: job.maxRetries,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 500 },
        }).catch((e: any) => console.warn('[BullMQ] add failed, DB queue remains:', e.message));
      }
    } catch {}
    return job;
  }

  public getPendingJobs(): QueueJob<QueueablePayload>[] {
    const now = Date.now();
    return this.queue.filter(j => j.status === 'QUEUED' && new Date(j.nextAttemptAt).getTime() <= now);
  }

  public getDLQJobs(): QueueJob<QueueablePayload>[] {
    return this.dlq;
  }

  public async moveToDLQ(job: QueueJob<QueueablePayload>, reason: string) {
    job.status = 'DLQ';
    job.lastError = reason;
    job.updatedAt = new Date().toISOString();
    this.dlq.push(job);
    this.queue = this.queue.filter(j => j.id !== job.id);
    try {
      const prisma = getPrisma();
      await prisma.queueJob.update({
        where: { id: job.id },
        data: { status: 'DLQ', lastError: reason, attempts: job.attempts, updatedAt: new Date() }
      }).catch(async () => {
        // Row may not exist if created before DB migration
        await prisma.queueJob.create({
          data: {
            id: job.id,
            tenantId: job.tenantId,
            jobName: 'signInvoice',
            payload: JSON.stringify(job.data),
            attempts: job.attempts,
            maxRetries: job.maxRetries,
            status: 'DLQ',
            lastError: reason,
            nextAttemptAt: new Date(job.nextAttemptAt),
          }
        }).catch(()=>{});
      });
      await prisma.$disconnect().catch(()=>{});
    } catch {}
  }

  public async removeJob(jobId: string) {
    this.queue = this.queue.filter(j => j.id !== jobId);
    try {
      const prisma = getPrisma();
      await prisma.queueJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', updatedAt: new Date() }
      }).catch(()=>{});
      // Optionally delete completed after 7 days retention - keep for audit now
      await prisma.$disconnect().catch(()=>{});
    } catch {}
  }

  public async updateJob(job: QueueJob<QueueablePayload>) {
    try {
      const prisma = getPrisma();
      await prisma.queueJob.update({
        where: { id: job.id },
        data: {
          attempts: job.attempts,
          status: job.status,
          lastError: job.lastError || null,
          nextAttemptAt: new Date(job.nextAttemptAt),
          updatedAt: new Date(job.updatedAt),
        }
      }).catch(()=>{});
      await prisma.$disconnect().catch(()=>{});
    } catch {}
  }

  public getQueueStats() {
    return {
      queued: this.queue.filter(j => j.status === 'QUEUED').length,
      processing: this.queue.filter(j => j.status === 'PROCESSING').length,
      completed: this.queue.filter(j => j.status === 'COMPLETED').length,
      failedInDLQ: this.dlq.length,
      engine: bullMqEnabled ? 'bullmq+redis' as const : 'db-memory' as const,
      bullMqReady: bullMqEnabled,
    };
  }

  public isBullMqEnabled(): boolean { return bullMqEnabled; }
  public getBullMqQueue(): any { return bullMqQueue; }

  // Re-hydrate + recover orphaned PENDING_NRS_STAMP invoices that have no queue entry
  public async recoverOrphans(): Promise<number> {
    await this.hydrateIfNeeded();
    try {
      const prisma = getPrisma();
      const orphans = await prisma.invoice.findMany({
        where: { status: 'PENDING_NRS_STAMP' },
        include: { lineItems: true },
        take: 100,
        orderBy: { createdAt: 'asc' },
      });
      let recovered = 0;
      for (const inv of orphans) {
        const alreadyQueued = this.queue.some(j => (j.data as any).dbInvoiceId === inv.id);
        if (alreadyQueued) continue;
        // Skip very recent invoices (<30s) to avoid double-enqueue on normal flow
        if (Date.now() - new Date(inv.createdAt).getTime() < 30000) continue;
        const payload: any = {
          tenantId: inv.tenantId,
          clientInvoiceNumber: inv.clientInvoiceId,
          documentNumber: inv.documentNumber || undefined,
          invoiceType: inv.invoiceType as any,
          invoiceKind: inv.invoiceKind as any,
          issueDate: inv.issueDate.toISOString().substring(0,10),
          customerCode: inv.customerCode,
          customerName: inv.customerName,
          customerTin: inv.customerTin || undefined,
          lineItems: inv.lineItems.map((li: any) => ({
            itemCode: li.itemCode,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            taxableAmount: li.taxableAmount,
            vatRate: li.vatRate,
            vatAmount: li.vatAmount,
            totalAmount: li.totalAmount,
            hsOrServiceCode: li.hsOrServiceCode,
          })),
          dbInvoiceId: inv.id,
        };
        await this.add('signInvoice', payload);
        recovered++;
      }
      await prisma.$disconnect().catch(()=>{});
      return recovered;
    } catch (e) {
      console.warn('[Queue] Orphan recovery failed:', (e as any)?.message);
      return 0;
    }
  }
}

export const invoiceQueue = new InvoiceQueueManager();
