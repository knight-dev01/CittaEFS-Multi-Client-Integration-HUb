import { ValidatedInvoiceIngestion } from '../schemas/invoice.schema';

// The queued payload always carries the DB Invoice row's primary key (dbInvoiceId)
// so the worker can write the gateway's IRN/QR result back to the correct row,
// independent of whatever client-facing invoice number/ID scheme the source uses.
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
  // Gate for the poller: a QUEUED job isn't eligible for reprocessing until this time,
  // so the backoffMs schedule is actually honored instead of retrying every poll tick.
  nextAttemptAt: string;
}

// In-Memory Queue Store (Simulating BullMQ Redis producer pattern)
class InvoiceQueueManager {
  private queue: QueueJob<QueueablePayload>[] = [];
  private dlq: QueueJob<QueueablePayload>[] = [];

  // Enqueue new job for async queue worker processing
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
      backoffMs: [5000, 30000, 120000, 600000, 1800000], // 5s, 30s, 2m, 10m, 30m
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString()
    };

    this.queue.push(job);
    return job;
  }

  public getPendingJobs(): QueueJob<QueueablePayload>[] {
    const now = Date.now();
    return this.queue.filter(j => j.status === 'QUEUED' && new Date(j.nextAttemptAt).getTime() <= now);
  }

  public getDLQJobs(): QueueJob<QueueablePayload>[] {
    return this.dlq;
  }

  public moveToDLQ(job: QueueJob<QueueablePayload>, reason: string) {
    job.status = 'DLQ';
    job.lastError = reason;
    job.updatedAt = new Date().toISOString();
    this.dlq.push(job);
    this.queue = this.queue.filter(j => j.id !== job.id);
  }

  public removeJob(jobId: string) {
    this.queue = this.queue.filter(j => j.id !== jobId);
  }

  public getQueueStats() {
    return {
      queued: this.queue.filter(j => j.status === 'QUEUED').length,
      processing: this.queue.filter(j => j.status === 'PROCESSING').length,
      completed: this.queue.filter(j => j.status === 'COMPLETED').length,
      failedInDLQ: this.dlq.length
    };
  }
}

export const invoiceQueue = new InvoiceQueueManager();
