import { ValidatedInvoiceIngestion } from '../schemas/invoice.schema';

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
}

// In-Memory Queue Store (Simulating BullMQ Redis producer pattern)
class InvoiceQueueManager {
  private queue: QueueJob<ValidatedInvoiceIngestion>[] = [];
  private dlq: QueueJob<ValidatedInvoiceIngestion>[] = [];

  // Enqueue new job for async queue worker processing
  public async add(
    jobName: string,
    payload: ValidatedInvoiceIngestion,
    options: { attempts?: number; backoff?: { type: string; delay: number } } = {}
  ): Promise<QueueJob<ValidatedInvoiceIngestion>> {
    const job: QueueJob<ValidatedInvoiceIngestion> = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId: payload.tenantId,
      data: payload,
      attempts: 0,
      maxRetries: options.attempts || 5,
      backoffMs: [5000, 30000, 120000, 600000, 1800000], // 5s, 30s, 2m, 10m, 30m
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.queue.push(job);
    return job;
  }

  public getPendingJobs(): QueueJob<ValidatedInvoiceIngestion>[] {
    return this.queue.filter(j => j.status === 'QUEUED');
  }

  public getDLQJobs(): QueueJob<ValidatedInvoiceIngestion>[] {
    return this.dlq;
  }

  public moveToDLQ(job: QueueJob<ValidatedInvoiceIngestion>, reason: string) {
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
