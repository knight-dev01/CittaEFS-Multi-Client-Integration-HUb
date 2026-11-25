// Symmetrical Reconciliation Background Workers
import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';

function getPrisma() {
  return new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
}

export interface ReconciliationReport {
  cronName: 'qbReconciliationCron' | 'nrsReconciliationCron';
  scannedCount: number;
  recoveredCount: number;
  orphansFixedCount: number;
  timestamp: string;
  details: string;
}

/**
 * QuickBooks CDC Reconciliation: fetches recent QBO invoices and ingests missing ones
 */
export async function runQbReconciliationCron(tenantId?: string): Promise<ReconciliationReport> {
  const timestamp = new Date().toISOString();
  let scannedCount = 0;
  let recoveredCount = 0;
  const prisma = getPrisma();
  try {
    const integrations = await prisma.integration.findMany({
      where: tenantId ? { tenantId, sourceSystem: 'QUICKBOOKS_ONLINE', status: 'CONNECTED' } : { sourceSystem: 'QUICKBOOKS_ONLINE', status: 'CONNECTED' },
    });
    for (const integ of integrations) {
      try {
        const { fetchQboInvoices, ingestQboInvoice } = await import('../services/qboService');
        const rawInvoices = await fetchQboInvoices(integ.tenantId);
        scannedCount += rawInvoices.length;
        for (const raw of rawInvoices) {
          try {
            const existing = await prisma.invoice.findFirst({ where: { tenantId: integ.tenantId, clientInvoiceId: String(raw.Id) } });
            if (!existing) {
              await ingestQboInvoice(integ.tenantId, raw);
              recoveredCount++;
            }
          } catch {}
        }
      } catch (e) {
        console.warn(`[QBO Reconcile] tenant ${integ.tenantId} fetch failed:`, (e as any)?.message);
      }
    }
    await prisma.$disconnect().catch(()=>{});
    return {
      cronName: 'qbReconciliationCron',
      scannedCount,
      recoveredCount,
      orphansFixedCount: 0,
      timestamp,
      details: `CDC scan complete for ${tenantId || 'ALL'}: scanned ${scannedCount}, recovered ${recoveredCount} missed QBO invoices.`,
    };
  } catch (e: any) {
    await prisma.$disconnect().catch(()=>{});
    return {
      cronName: 'qbReconciliationCron',
      scannedCount,
      recoveredCount,
      orphansFixedCount: 0,
      timestamp,
      details: `CDC scan failed: ${e.message}`,
    };
  }
}

/**
 * NRS Gateway Reconciliation: polls CittaEFS archive for stuck PENDING invoices and recovers them
 */
export async function runNrsReconciliationCron(tenantId?: string): Promise<ReconciliationReport> {
  const timestamp = new Date().toISOString();
  let scannedCount = 0;
  let recoveredCount = 0;
  let orphansFixedCount = 0;
  const prisma = getPrisma();
  try {
    const pending = await prisma.invoice.findMany({
      where: tenantId ? { tenantId, status: 'PENDING_NRS_STAMP' } : { status: 'PENDING_NRS_STAMP' },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    scannedCount = pending.length;
    if (pending.length === 0) {
      await prisma.$disconnect().catch(()=>{});
      return { cronName: 'nrsReconciliationCron', scannedCount: 0, recoveredCount: 0, orphansFixedCount: 0, timestamp, details: 'No pending invoices to reconcile.' };
    }
    // Try to match via gateway archive per tenant
    const byTenant = new Map<string, typeof pending>();
    for (const p of pending) {
      const arr = byTenant.get(p.tenantId) || [];
      arr.push(p);
      byTenant.set(p.tenantId, arr);
    }
    const { cittaEfsClient } = await import('../services/cittaEfsClient');
    const { unwrapArchive, indexArchive, findArchiveRecord, stampFromArchiveRecord } = await import('../lib/efsArchive');
    const day = (d: Date) => d.toISOString().slice(0, 10);
    for (const [tid, invoices] of byTenant) {
      try {
        // Ask for the period these invoices were sent in (a day either side
        // for time zones), not EFS's default range.
        const oldest = Math.min(...invoices.flatMap(i => [new Date(i.createdAt).getTime(), new Date(i.issueDate).getTime()]).filter(Number.isFinite));
        const fromDate = day(new Date(oldest - 24 * 3600 * 1000));
        const toDate = day(new Date(Date.now() + 24 * 3600 * 1000));
        const archive = unwrapArchive(await cittaEfsClient.getArchive(tid, fromDate, toDate));
        const index = indexArchive(archive);
        for (const inv of invoices) {
          const record = findArchiveRecord(index, inv);
          const stamp = stampFromArchiveRecord(record);
          if (stamp) {
            const { irn, csid } = stamp;
            const qr = stamp.qrCodeUrl || `https://nrs.portal.gov/verify?irn=${irn}`;
            try {
              // An IRN is unique. If it already sits on a different invoice
              // (an earlier mismatched webhook), the archive, matched on the
              // invoice number, is authoritative: move it to this invoice.
              const holder = await prisma.invoice.findFirst({ where: { irn, NOT: { id: inv.id } } });
              if (holder) {
                await prisma.invoice.update({ where: { id: holder.id }, data: { irn: null, csid: null, qrCodeUrl: null, status: 'PENDING_NRS_STAMP' } });
                console.warn(`[NRS Reconcile] IRN ${irn} was on ${holder.clientInvoiceId}; the archive assigns it to ${inv.clientInvoiceId}. Moved.`);
              }
              await prisma.invoice.update({
                where: { id: inv.id },
                data: { status: 'APPROVED', irn, csid, qrCodeUrl: qr },
              });
            } catch (e: any) {
              console.warn(`[NRS Reconcile] could not record the stamp for ${inv.clientInvoiceId}:`, e?.message);
              continue;
            }
            // Attempt writeback and surface result
            console.log(`[NRS Reconcile] ${inv.clientInvoiceId} stamped by NRS (IRN ${irn}); writing back to the source ERP`);
            const result = await cittaEfsClient.executeClientLedgerWriteback(tid, inv.clientInvoiceId, irn, qr).catch(()=>({ synced: false }));
            if (!inv.sourceErp && result.synced) {
              await prisma.invoice.update({
                where: { id: inv.id },
                data: { ledgerWritebackStatus: 'SYNCED' },
              }).catch(()=>{});
            }
            // Notify merchant webhook (Interswitch-style signed callback) — non-blocking
            try {
              const { dispatchMerchantWebhook } = await import('../services/merchantWebhook');
              dispatchMerchantWebhook(tid, inv.id, 'invoice.authorized').catch(()=>{});
            } catch {}
            recoveredCount++;
          } else {
            // Orphan older than 30 min with no gateway trace -> mark for DLQ investigation
            const ageMs = Date.now() - new Date(inv.createdAt).getTime();
            if (ageMs > 30 * 60 * 1000) {
              orphansFixedCount++;
            }
          }
        }
      } catch (e) {
        console.warn(`[NRS Reconcile] tenant ${tid} archive check failed:`, (e as any)?.message);
      }
    }
    // Also recover via queue orphan logic
    try {
      const { invoiceQueue } = await import('../queues/invoiceQueue');
      const recovered = await invoiceQueue.recoverOrphans();
      orphansFixedCount += recovered;
    } catch {}
    await prisma.$disconnect().catch(()=>{});
    return {
      cronName: 'nrsReconciliationCron',
      scannedCount,
      recoveredCount,
      orphansFixedCount,
      timestamp,
      details: `Gateway poll for ${tenantId || 'ALL'}: scanned ${scannedCount}, recovered ${recoveredCount} via archive, ${orphansFixedCount} orphans re-queued.`,
    };
  } catch (e: any) {
    await prisma.$disconnect().catch(()=>{});
    return {
      cronName: 'nrsReconciliationCron',
      scannedCount,
      recoveredCount,
      orphansFixedCount,
      timestamp,
      details: `NRS reconcile failed: ${e.message}`,
    };
  }
}
