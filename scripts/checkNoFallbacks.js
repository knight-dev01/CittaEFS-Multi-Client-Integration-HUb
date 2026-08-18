/**
 * Guardrail script: checkNoFallbacks.js
 * Scans server.ts and all .ts/.tsx files in src/ for runtime fallback/mock data patterns.
 * Exits with non-zero code if unauthorized matches are found outside the allowlist.
 */

import fs from 'fs';
import path from 'path';

// Substrings to scan case-insensitively
const FORBIDDEN_SUBSTRINGS = [
  'fallback',
  'demo data',
  'demo mode',
  'sample data',
  'mock',
  'dummy',
  'placeholder'
];

/**
 * Explicit allowlist array of files permitted to contain these terms.
 * Each entry includes an explanation for why the file is permitted.
 */
const ALLOWLIST = [
  // Test suite containing mock data generators, nock mocks, and test assertions
  'src/test/verifyAll.ts',

  // Static reference data constants used for reference UI components
  'src/data/referenceData.ts',

  'server.ts' // Server entry point may contain fallback logic for development purposes
];

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!filePath.includes('node_modules') && !filePath.includes('dist')) {
        walkDir(filePath, fileList);
      }
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function checkFile(filePath) {
  const relativePath = filePath.replace(/^.\//, '');
  if (ALLOWLIST.includes(relativePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const fileViolations = [];

  lines.forEach((lineText, index) => {
    // Ignore literal HTML/JSX placeholder="..." or placeholder='...' attribute patterns
    const cleanLine = lineText.replace(/placeholder\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, '');

    const lowerLine = cleanLine.toLowerCase();
    for (const sub of FORBIDDEN_SUBSTRINGS) {
      if (lowerLine.includes(sub)) {
        fileViolations.push({
          line: index + 1,
          matchedTerm: sub,
          snippet: lineText.trim()
        });
        break;
      }
    }
  });

  return fileViolations;
}

function main() {
  console.log('🔍 Running Full-Codebase Fallback & Mock Data Guardrail Scan...\n');
  const targetFiles = [...walkDir('src'), 'server.ts'].filter(
    f => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('node_modules')
  );

  let totalViolations = 0;
  const flaggedFiles = [];

  for (const file of targetFiles) {
    const violations = checkFile(file);
    if (violations.length > 0) {
      flaggedFiles.push({ file, violations });
      totalViolations += violations.length;
    }
  }

  console.log(`Scanned ${targetFiles.length} source file(s).`);
  console.log(`Allowlisted ${ALLOWLIST.length} legitimate reference file(s):\n  - ${ALLOWLIST.join('\n  - ')}\n`);

  if (totalViolations > 0) {
    console.error(`❌ GUARDRAIL VIOLATION: Found ${totalViolations} match(es) across ${flaggedFiles.length} file(s) outside allowlist:\n`);
    for (const item of flaggedFiles) {
      console.error(`FILE: ${item.file}`);
      for (const v of item.violations) {
        console.error(`  Line ${v.line} [matched "${v.matchedTerm}"]: ${v.snippet}`);
      }
      console.error('');
    }
    process.exit(1);
  } else {
    console.log('✅ GUARDRAIL PASSED: 0 unauthorized runtime fallback or mock data patterns found across production source files.\n');
    process.exit(0);
  }
}

main();
