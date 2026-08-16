const fs = require('fs');
const path = require('path');
 fix/render-bootstrap-admin-seed-and-api-routing
const { execFileSync } = require('child_process');
=======
const { spawnSync } = require('child_process');
main

const distServer = path.join(__dirname, 'dist', 'server.cjs');

// Optional one-shot seeding mechanism controlled by ENABLE_ADMIN_SEED env var.
// Set ENABLE_ADMIN_SEED=true in your Render environment to run the seed on first startup.
// The script will create a marker file .admin_seed_done after successful run so it doesn't re-run repeatedly.
try {
  const seedFlag = process.env.ENABLE_ADMIN_SEED === 'true';
  const seedMarker = path.join(__dirname, '.admin_seed_done');
  const seedScript = path.join(__dirname, 'scripts', 'create-admin.cjs');

  if (seedFlag) {
    if (!fs.existsSync(seedScript)) {
      console.warn('[SEED] create-admin script not found at scripts/create-admin.cjs; skipping seeding.');
    } else if (fs.existsSync(seedMarker)) {
      console.log('[SEED] Marker file found; skipping admin seed.');
    } else {
      console.log('[SEED] ENABLE_ADMIN_SEED=true detected. Running admin seed script...');
      const result = spawnSync(process.execPath, [seedScript], {
        stdio: 'inherit',
        env: process.env,
        cwd: __dirname,
      });

      if (result.error) {
        console.error('[SEED] Failed to execute create-admin.cjs:', result.error);
      } else if (result.status !== 0) {
        console.error('[SEED] create-admin.cjs exited with code', result.status);
      } else {
        try {
          fs.writeFileSync(seedMarker, `seeded at ${new Date().toISOString()}\n`);
          console.log('[SEED] Admin seed completed successfully and marker file created.');
        } catch (err) {
          console.warn('[SEED] Admin seed succeeded but failed to write marker file:', err);
        }
      }
    }
  }
} catch (err) {
  console.warn('[SEED] Unexpected error during seed check:', err);
}

if (!fs.existsSync(distServer)) {
  console.error('❌ CRITICAL ERROR: dist/server.cjs not found. Please run "npm run build" before starting the server.');
  process.exit(1);
}

/**
 * Idempotent production bootstrap, run before the HTTP server starts so every
 * Render deploy (1) reconciles the database schema and (2) guarantees the admin
 * operator account exists with a matching bcrypt password hash. Safe to run on
 * every boot: migrations are a no-op when up-to-date, and the user upsert only
 * touches the env-defined admin/operator accounts.
 *
 * Gated behind DATABASE_URL: without it there is nothing to bootstrap against
 * and the Prisma client in server.cjs would throw at first query anyway.
 */
async function bootstrap() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    console.error('❌ DATABASE_URL is not set; cannot run migrations or ensure admin user. Aborting startup.');
    process.exit(1);
  }

  // 1. Apply pending migrations. Non-fatal: a database previously initialized
  //    via `prisma db push` (no _prisma_migrations history) would reject this,
  //    but the schema is already correct in that case, so we warn and continue.
  const prismaBin = path.join(__dirname, 'node_modules', '.bin', 'prisma');
  if (fs.existsSync(prismaBin)) {
    console.log('📦 Applying pending Prisma migrations (migrate deploy)...');
    try {
      execFileSync(prismaBin, ['migrate', 'deploy'], {
        stdio: 'inherit',
        env: process.env,
        cwd: __dirname,
      });
      console.log('✅ Migrations reconciled.');
    } catch (err) {
      console.warn('⚠️  prisma migrate deploy failed (schema may already be applied via db push). Continuing. Detail:', err.message);
    }
  } else {
    console.warn('⚠️  prisma CLI not found at ' + prismaBin + '; skipping migrate deploy.');
  }

  // 2. Ensure the admin (and optional operator) account exists. Mirrors
  //    prisma/seed.ts but is NON-destructive (no invoice/master purge) so it is
  //    safe to run on every boot against a live production database.
  console.log('🔐 Ensuring admin user exists...');
  let PrismaClientCtor;
  try {
    // @prisma/client is an externalized dependency (present in node_modules),
    // not bundled into dist/server.cjs, so it resolves from the install root.
    const prismaClient = require('@prisma/client');
    PrismaClientCtor = prismaClient.PrismaClient;
  } catch (err) {
    console.error('❌ Could not load @prisma/client for admin bootstrap:', err.message);
    process.exit(1);
  }
  let bcrypt;
  try {
    bcrypt = require('bcryptjs');
  } catch (err) {
    console.error('❌ Could not load bcryptjs for admin bootstrap:', err.message);
    process.exit(1);
  }

  const prisma = new PrismaClientCtor();
  try {
    // The login route normalizes email to lowercase+trim before lookup, so store
    // the lowercased value to guarantee findUnique matches regardless of env casing.
    const users = [];

    const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@cittaefs.com').toLowerCase().trim();
    users.push({
      email: adminEmail,
      name: process.env.DEFAULT_ADMIN_NAME || 'System Administrator',
      password: process.env.DEFAULT_ADMIN_PASSWORD || 'Admin123!',
      role: 'ADMIN',
      organization: process.env.DEFAULT_ADMIN_ORG || 'CittaEFS Enterprise',
    });

    if (process.env.DEFAULT_OPERATOR_EMAIL && process.env.DEFAULT_OPERATOR_PASSWORD) {
      users.push({
        email: process.env.DEFAULT_OPERATOR_EMAIL.toLowerCase().trim(),
        name: process.env.DEFAULT_OPERATOR_NAME || 'System Operator',
        password: process.env.DEFAULT_OPERATOR_PASSWORD,
        role: 'OPERATOR',
        organization: process.env.DEFAULT_OPERATOR_ORG || 'Default Organization',
      });
    }

    for (const u of users) {
      const passwordHash = bcrypt.hashSync(u.password, 10);
      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, passwordHash, role: u.role, organization: u.organization },
        create: { email: u.email, name: u.name, passwordHash, role: u.role, organization: u.organization, tenantId: null },
      });
      console.log(`   👤 User ensured: [${u.role}] ${u.email}`);
    }
    console.log('✅ Admin bootstrap complete.');
  } catch (err) {
    console.error('❌ Admin user bootstrap failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

bootstrap()
  .then(() => {
    console.log('🚀 Starting server from dist/server.cjs...');
    require(distServer);
  })
  .catch((err) => {
    console.error('❌ Bootstrap failed:', err);
    process.exit(1);
  });
