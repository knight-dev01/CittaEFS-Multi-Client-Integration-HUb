const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

console.log('🚀 Starting server from dist/server.cjs...');
require(distServer);
