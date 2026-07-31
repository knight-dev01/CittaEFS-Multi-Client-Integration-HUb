const fs = require('fs');
const path = require('path');

const distServer = path.join(__dirname, 'dist', 'server.cjs');

if (!fs.existsSync(distServer)) {
  console.error('❌ CRITICAL ERROR: dist/server.cjs not found. Please run "npm run build" before starting the server.');
  process.exit(1);
}

console.log('🚀 Starting server from dist/server.cjs...');
require(distServer);
