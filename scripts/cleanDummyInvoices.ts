import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../src/config/dbConfig';

const prisma = new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });

async function main() {
  const patterns = [
    { field: 'clientInvoiceId', like: 'TEST-%' },
    { field: 'clientInvoiceId', like: 'DUP-TEST-%' },
    { field: 'clientInvoiceId', like: 'INV-HMAC-TEST-%' },
    { field: 'clientInvoiceId', like: '%WORKER-TEST%' },
  ];

  console.log('Preview dummy invoices...');
  const whereOr = patterns.map(p => ({ [p.field]: { startsWith: p.like.replace('-%', '') } }) as any);
  // Simpler: use OR with startsWith
  const where = {
    OR: [
      { clientInvoiceId: { startsWith: 'TEST-' } },
      { clientInvoiceId: { startsWith: 'DUP-TEST-' } },
      { clientInvoiceId: { startsWith: 'INV-HMAC-TEST-' } },
      { clientInvoiceId: { contains: 'WORKER-TEST' } },
    ]
  };
  const count = await prisma.invoice.count({ where });
  console.log(`Found ${count} dummy invoices`);

  if (count === 0) {
    console.log('Nothing to delete');
    await prisma.$disconnect();
    return;
  }

  const deleted = await prisma.invoice.deleteMany({ where });
  console.log(`Deleted ${deleted.count} invoices`);

  const veDeleted = await prisma.validationError.deleteMany({
    where: {
      OR: [
        { clientInvoiceNumber: { contains: 'TEST' } },
        { clientInvoiceNumber: { contains: 'WORKER-TEST' } },
      ]
    }
  });
  console.log(`Deleted ${veDeleted.count} validation errors`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
