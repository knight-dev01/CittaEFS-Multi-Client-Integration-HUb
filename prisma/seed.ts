import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

import { getDatabaseUrl } from '../src/config/dbConfig.ts';
import { INITIAL_TENANTS } from '../src/data/referenceData.ts';

process.env.DATABASE_URL = getDatabaseUrl(true);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(true)
    }
  }
});

async function main() {
  console.log('🌱 Starting CittaEFS Hub Clean Initializer...');

  const tenantsConfig = INITIAL_TENANTS.map(t => ({
    id: t.id,
    name: t.name,
    companyName: t.companyName,
    tin: t.tin,
    platformType: t.platformType,
    marketTier: t.marketTier,
    cittaApiKey: t.cittaApiKey,
    onboardingStatus: t.onboardingStatus,
    monthlyAllowance: t.monthlyAllowance,
    monthlyUsed: t.monthlyUsed
  }));

  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

  if (hasDatabaseUrl) {
    try {
      console.log('🧹 Purging any lingering dummy records...');
      await prisma.invoiceLineItem.deleteMany();
      await prisma.invoice.deleteMany();
      await prisma.validationError.deleteMany();
      await prisma.customer.deleteMany();
      await prisma.item.deleteMany();
      await prisma.auditLog.deleteMany();
      console.log('✅ Purged dummy data.');
    } catch (e) {
      console.warn('Warning during purge:', e);
    }
  }

  for (const tConfig of tenantsConfig) {
    console.log(`\n🏢 Initializing Tenant: ${tConfig.name}...`);
    if (hasDatabaseUrl) {
      try {
        await prisma.tenant.upsert({
          where: { id: tConfig.id },
          update: tConfig,
          create: tConfig
        });
      } catch (err) {
        console.warn(`   ⚠️ Database connection warning for ${tConfig.id}:`, err);
      }
    }
  }

  const defaultUsers = [
    { email: 'admin@cittaefs.com', name: 'James Carter', password: 'Admin123!', role: 'ADMIN', organization: 'CittaEFS Enterprise', tenantId: '' },
    { email: 'operator@cittaefs.com', name: 'CittaEFS Operator', password: 'Operator123!', role: 'OPERATOR', organization: 'CittaEFS Operations', tenantId: '' }
  ];

  if (hasDatabaseUrl) {
    console.log('\n🔐 Seeding Default Users (Admin & Operator only)...');
    try {
      await prisma.user.deleteMany({
        where: {
          NOT: {
            email: { in: ['admin@cittaefs.com', 'operator@cittaefs.com'] }
          }
        }
      });
      console.log('🧹 Purged obsolete user accounts.');
    } catch (e) {
      console.warn('Warning purging obsolete users:', e);
    }
    for (const u of defaultUsers) {
      const passwordHash = bcrypt.hashSync(u.password, 10);
      try {
        await prisma.user.upsert({
          where: { email: u.email },
          update: {
            name: u.name,
            passwordHash,
            role: u.role,
            organization: u.organization,
            tenantId: u.tenantId
          },
          create: {
            email: u.email,
            name: u.name,
            passwordHash,
            role: u.role,
            organization: u.organization,
            tenantId: u.tenantId
          }
        });
        console.log(`   👤 User Seeded: [${u.role}] ${u.email}`);
      } catch (e) {
        console.warn(`⚠️ User seeding warning for ${u.email}:`, e);
      }
    }
    console.log('✅ Seeded default users successfully.');
  }

  console.log('🎉 Clean initialization complete - only real data will be ingested!');
}

main()
  .catch((e) => {
    console.error('❌ Error during clean init:', e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
