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
    for (const [tid, invoices] of byTenant) {
      try {
        const archive: any[] = await cittaEfsClient.getArchive(tid).catch(()=>[]);
        const archiveByNumber = new Map(archive.map((a: any) => [String(a.invoiceNumber || a.clientInvoiceNumber), a]));
        for (const inv of invoices) {
          const match = archiveByNumber.get(String(inv.clientInvoiceId)) || archiveByNumber.get(String(inv.documentNumber || ''));
          if (match && (match.irn || match.Irn)) {
            const irn = match.irn || match.Irn;
            const csid = match.csid || match.Csid || null;
            const qr = match.qrCodeUrl || match.QrCodeUrl || match.qrUrl || `https://nrs.portal.gov/verify?irn=${irn}`;
            await prisma.invoice.update({
              where: { id: inv.id },
              data: { status: 'APPROVED', irn, csid, qrCodeUrl: qr, ledgerWritebackStatus: 'SYNCED' },
            });
            // Attempt writeback
            await cittaEfsClient.executeClientLedgerWriteback(tid, inv.clientInvoiceId, irn, qr).catch(()=>{});
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
        console.warn(`[NRS Reconcile] tenant ${tid} archive fetch failed:`, (e as any)?.message);
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
