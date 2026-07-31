import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

import { getDatabaseUrl } from '../src/config/dbConfig.ts';

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

  const tenantsConfig = [
    {
      id: 'tenant_qbo_smb',
      name: 'Acme Retail & Distro (QuickBooks Online)',
      companyName: 'Acme Retail Solutions Ltd',
      tin: 'P051239841A',
      platformType: 'QuickBooks Online',
      marketTier: 'Tier 1 (SMB)',
      cittaApiKey: 'sk_live_lNZAJM5WajKYQVBo3atXDNXxM33ijmAt4Xsj7lUz',
      onboardingStatus: 'LIVE_PRODUCTION',
      monthlyAllowance: 1000,
      monthlyUsed: 0
    }
  ];

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
    { email: 'admin@cittaefs.com', name: 'Sarah Jenkins', password: 'Admin123!', role: 'ADMIN', organization: 'CittaEFS Enterprise', tenantId: 'tenant_qbo_smb' },
    { email: 'd.okafor@cittaefs.com', name: 'David Okafor', password: 'Okafor2026!', role: 'INTEGRATION_MANAGER', organization: 'QuickBooks Integration Group', tenantId: 'tenant_qbo_smb' },
    { email: 'billing@acme.com', name: 'Amara Vance', password: 'Acme2026!', role: 'OPERATOR', organization: 'Acme Retail Solutions Ltd', tenantId: 'tenant_qbo_smb' }
  ];

  if (hasDatabaseUrl) {
    console.log('\n🔐 Seeding Default Users...');
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
