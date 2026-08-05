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

  // Default admin user - always created unless explicitly disabled
  const defaultUsers: Array<{email: string; name: string; password: string; role: string; organization: string; tenantId: string | null}> = [];
  
  // Use env vars if provided, otherwise use defaults
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@cittaefs.com';
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin123!';
  const adminName = process.env.DEFAULT_ADMIN_NAME || 'System Administrator';
  const adminOrg = process.env.DEFAULT_ADMIN_ORG || 'CittaEFS Enterprise';
  
  defaultUsers.push({
    email: adminEmail,
    name: adminName,
    password: adminPassword,
    role: 'ADMIN',
    organization: adminOrg,
    tenantId: null
  });
  
  // Optional operator user
  if (process.env.DEFAULT_OPERATOR_EMAIL && process.env.DEFAULT_OPERATOR_PASSWORD) {
    defaultUsers.push({
      email: process.env.DEFAULT_OPERATOR_EMAIL,
      name: process.env.DEFAULT_OPERATOR_NAME || 'System Operator',
      password: process.env.DEFAULT_OPERATOR_PASSWORD,
      role: 'OPERATOR',
      organization: process.env.DEFAULT_OPERATOR_ORG || 'Default Organization',
      tenantId: null
    });
  }
  
  console.log('ℹ️ Default admin user will be seeded:');
  console.log(`   Email: ${adminEmail}`);
  console.log('   Password: [hidden]');
  if (process.env.DEFAULT_ADMIN_EMAIL) {
    console.log('   (from environment variables)');
  } else {
    console.log('   (using default - change via DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD env vars)');
  }

  if (hasDatabaseUrl) {
    if (defaultUsers.length > 0) {
      console.log('\n🔐 Seeding Default Users...');
      const seededEmails = defaultUsers.map(u => u.email);
      
      // Only purge users not in the seeded list
      try {
        await prisma.user.deleteMany({
          where: {
            email: { notIn: seededEmails }
          }
        });
        console.log('🧹 Purged user accounts not in seed list.');
      } catch (e) {
        console.error('Warning purging obsolete users:', e);
      }
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
