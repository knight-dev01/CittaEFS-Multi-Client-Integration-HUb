import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { packEncryptedString } from '../src/config/encryption';

import { getDatabaseUrl } from '../src/config/dbConfig.ts';

process.env.DATABASE_URL = getDatabaseUrl(true);

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting CittaEFS Hub Database Seeder & Mock Data Generator...');

  const tenantsConfig = [
    {
      id: 'tenant_qbo_smb',
      name: 'Acme Retail & Distro (QuickBooks Online)',
      companyName: 'Acme Retail Solutions Ltd',
      tin: 'P051239841A',
      platformType: 'QuickBooks Online',
      marketTier: 'Tier 1 (SMB)',
      onboardingStatus: 'LIVE_PRODUCTION',
      monthlyAllowance: 1000,
      monthlyUsed: 384
    },
    {
      id: 'tenant_sage_ent',
      name: 'Savannah Logistics & Sage (Sage ERP)',
      companyName: 'Savannah Logistics Group SA',
      tin: 'P051987654A',
      platformType: 'Sage ERP',
      marketTier: 'Tier 3 (Enterprise)',
      onboardingStatus: 'NRS_VERIFIED',
      monthlyAllowance: 5000,
      monthlyUsed: 1420
    },
    {
      id: 'tenant_excel_drop',
      name: 'Metro Wholesale (Excel / CSV Drop)',
      companyName: 'Metro Wholesale Trading Co',
      tin: 'P077665544D',
      platformType: 'Excel & CSV Import',
      marketTier: 'Tier 4 (Legacy/CSV)',
      onboardingStatus: 'PENDING_MAPPING',
      monthlyAllowance: 2500,
      monthlyUsed: 120
    }
  ];

  const generatedSeedData: any = { tenants: [], datasets: {} };
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

  for (const tConfig of tenantsConfig) {
    console.log(`\n🏢 Processing Client / Tenant: ${tConfig.name}...`);
    
    const dbPayload = {
      ...tConfig
    };
    
    if (hasDatabaseUrl) {
      try {
        await prisma.tenant.upsert({
          where: { id: tConfig.id },
          update: dbPayload,
          create: dbPayload
        });
      } catch (err) {
        console.warn(`   ⚠️ Database connection warning for ${tConfig.id}:`, err);
      }
    }

    // 1. Generate Customers (25 customers per client -> > 20 required)
    const customers: any[] = [];
    for (let i = 1; i <= 25; i++) {
      const isB2B = i <= 20;
      const custCode = `${tConfig.platformType.substring(0, 3).toUpperCase()}-CUST-${1000 + i}`;
      const custObj = {
        id: `${tConfig.id}_cust_${i}`,
        clientSystemCustId: custCode,
        companyName: isB2B ? `Enterprise Client ${i} (${tConfig.platformType})` : `Consumer Walk-in ${i}`,
        email: `client${i}@${tConfig.id}.co.ke`,
        taxId: isB2B ? `P0${Math.floor(100000000 + Math.random() * 900000000)}Z` : 'N/A',
        taxClassification: isB2B ? 'B2B' : 'B2C',
        address: `Industrial Park, Plot ${i * 4}, Nairobi`,
        city: i % 2 === 0 ? 'Nairobi' : 'Mombasa',
        tenant: { connect: { id: tConfig.id } }
      };
      customers.push({ ...custObj, clientCustomerCode: custCode });

      if (hasDatabaseUrl) {
        try {
          await prisma.customer.upsert({
            where: { id: custObj.id },
            update: {
              clientSystemCustId: custObj.clientSystemCustId,
              companyName: custObj.companyName,
              email: custObj.email,
              taxId: custObj.taxId,
              taxClassification: custObj.taxClassification
            },
            create: custObj
          }).catch(() => {});
        } catch {}
      }
    }
    console.log(`   ✅ Generated 25 customers for ${tConfig.name}`);

    // 2. Generate Products / Items (55 products per client -> > 50 required)
    const items: any[] = [];
    const hsOrServiceCodes = [
      'HS-8471.30', 'HS-8517.62', 'HS-7304.11', 'HS-3926.90', 'HS-4819.10',
      'SRV-7212.10', 'SRV-7414.00', 'SRV-8703.20', 'SRV-6202.90', 'SRV-8010.15'
    ];

    for (let i = 1; i <= 55; i++) {
      const isService = i > 40;
      const itemObj = {
        id: `${tConfig.id}_item_${i}`,
        clientSku: `SKU-${tConfig.platformType.substring(0, 3).toUpperCase()}-${200 + i}`,
        description: `${isService ? 'Professional Service' : 'Hardware Product'} Item ${i} for ${tConfig.name}`,
        unitPrice: Math.floor(2000 + Math.random() * 300000),
        hsOrServiceCode: hsOrServiceCodes[i % hsOrServiceCodes.length],
        categoryType: isService ? 'SERVICES' : 'GOODS',
        defaultVatRate: 16.00,
        tenant: { connect: { id: tConfig.id } }
      };
      items.push(itemObj);

      if (hasDatabaseUrl) {
        try {
          await prisma.item.upsert({
            where: { id: itemObj.id },
            update: {
              clientSku: itemObj.clientSku,
              description: itemObj.description,
              unitPrice: itemObj.unitPrice,
              hsOrServiceCode: itemObj.hsOrServiceCode
            },
            create: itemObj
          }).catch(() => {});
        } catch {}
      }
    }
    console.log(`   ✅ Generated 55 products/items for ${tConfig.name}`);

    // 3. Generate Invoices (120 invoices per client -> > 100 required)
    const invoices: any[] = [];
    for (let i = 1; i <= 120; i++) {
      const cust = customers[i % customers.length];
      const prod = items[i % items.length];
      const invNum = `INV-${tConfig.platformType.substring(0, 3).toUpperCase()}-2026-${5000 + i}`;
      const isB2B = cust.taxClassification === 'B2B';
      const statusStr = i % 12 === 0 ? 'REJECTED' : (i % 6 === 0 ? 'APPROVED' : 'PENDING_NRS_STAMP');
      const isApproved = statusStr === 'APPROVED';

      const subtotal = Math.floor(40000 + Math.random() * 950000);
      const taxAmount = subtotal * 0.16;
      const totalAmount = subtotal + taxAmount;

      const invObj = {
        id: `${tConfig.id}_inv_${i}`,
        clientInvoiceId: invNum,
        invoiceType: 'STANDARD',
        invoiceKind: isB2B ? 'B2B' : 'B2C',
        issueDate: new Date(Date.now() - (120 - i) * 3600 * 24 * 1000),
        customerCode: cust.clientSystemCustId,
        customerName: cust.companyName,
        customerTin: cust.taxId,
        currency: 'KES',
        subtotal,
        taxAmount,
        totalAmount,
        status: statusStr,
        irn: isApproved ? `IRN-NRS-2026-${Math.floor(100000000 + Math.random() * 900000000)}` : null,
        csid: isApproved ? `CSID-KEY-${Math.floor(100000 + Math.random() * 900000)}` : null,
        qrCodeUrl: isApproved ? `https://cittaefs.gateway.ke/verify?irn=IRN-2026-${i}` : null,
        ledgerWritebackStatus: isApproved ? 'SYNCED' : 'PENDING',
        tenant: { connect: { id: tConfig.id } },
        lineItems: {
          create: [
            {
              itemCode: prod.clientSku,
              description: prod.description,
              quantity: 2,
              unitPrice: subtotal / 2,
              taxableAmount: subtotal,
              vatRate: 16.00,
              vatAmount: taxAmount,
              totalAmount: totalAmount,
              hsOrServiceCode: prod.hsOrServiceCode
            }
          ]
        }
      };
      invoices.push(invObj);

      if (hasDatabaseUrl) {
        try {
          await prisma.invoice.upsert({
            where: { id: invObj.id },
            update: {
              clientInvoiceId: invNum,
              status: statusStr,
              totalAmount,
              taxAmount
            },
            create: invObj
          }).catch(() => {});
        } catch {}
      }
    }
    console.log(`   ✅ Generated 120 invoices for ${tConfig.name}`);

    generatedSeedData.tenants.push(tConfig);
    generatedSeedData.datasets[tConfig.id] = {
      customersCount: customers.length,
      productsCount: items.length,
      invoicesCount: invoices.length,
      customers,
      items,
      invoices
    };
  }

  const outputDir = path.join(process.cwd(), 'src', 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(outputDir, 'seedData.json'),
    JSON.stringify(generatedSeedData, null, 2),
    'utf-8'
  );

  const defaultUsers = [
    { email: 'admin@cittaefs.com', name: 'Sarah Jenkins', password: 'Admin123!', role: 'ADMIN', organization: 'CittaEFS Enterprise', tenantId: 'tenant_qbo_smb' },
    { email: 'd.okafor@cittaefs.com', name: 'David Okafor', password: 'Okafor2026!', role: 'INTEGRATION_MANAGER', organization: 'QuickBooks Integration Group', tenantId: 'tenant_qbo_smb' },
    { email: 'billing@acme.com', name: 'Amara Vance', password: 'Acme2026!', role: 'OPERATOR', organization: 'Acme Retail Solutions Ltd', tenantId: 'tenant_qbo_smb' },
    { email: 'auditor@kra.gov.ke', name: 'Michael Chang', password: 'Kra2026!', role: 'AUDITOR', organization: 'Kenya Revenue Authority (KRA)', tenantId: 'tenant_qbo_smb' }
  ];

  if (hasDatabaseUrl) {
    console.log('\n🔐 Seeding Default Users & Generating Passwords...');
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
        console.log(`   👤 User Seeded: [${u.role}] ${u.email} / Password: ${u.password}`);
      } catch (e) {
        console.warn(`⚠️ User seeding warning for ${u.email}:`, e);
      }
    }
    console.log('✅ Seeded default users successfully.');
  }

  console.log('\n📁 Seed dataset successfully generated and saved to src/data/seedData.json');
  console.log('🎉 All mock data requirements generated successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
