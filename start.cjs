const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const distServer = path.join(__dirname, 'dist', 'server.cjs');

if (!fs.existsSync(distServer)) {
  console.log('⚡ dist/server.cjs not found. Triggering automated build step...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ Build failed during startup:', err);
    process.exit(1);
  }
}

console.log('🚀 Starting server from dist/server.cjs...');
require(distServer);
