#!/usr/bin/env node
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const prisma = new PrismaClient();
  try {
    const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@local.test').toLowerCase();
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMeNow!23';
    const tenantId = process.env.DEFAULT_ADMIN_TENANT || 'tenant_qbo_smb';

    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      console.log(`Admin already exists: ${adminEmail}`);
      return;
    }

    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    const userId = `usr_${Math.random().toString(36).substring(2, 9)}`;

    await prisma.user.create({
      data: {
        id: userId,
        email: adminEmail,
        passwordHash,
        name: 'Administrator',
        role: 'ADMIN',
        organization: 'CittaEFS',
        tenantId,
      },
    });

    console.log('Created admin:', adminEmail);
    console.log('Password:', adminPassword);
    console.log('Tip: change the password immediately after first login.');
  } catch (err) {
    console.error('Error creating admin:', err);
    process.exitCode = 1;
  } finally {
    try {
      await prisma.$disconnect();
    } catch {}
  }
}

main();
