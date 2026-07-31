/**
 * Guardrail script: checkNoFallbacks.js
 * Scans server.ts and src/ for unauthorized runtime fallback/mock data patterns
 * that mask database or API failures.
 * Exits with non-zero code if violations are found.
 */

import fs from 'fs';
import path from 'path';

const FORBIDDEN_PATTERNS = [
  {
    regex: /catch\s*\(\s*dbErr\s*\)[\s\S]*?DEMO_USERS/i,
    description: 'Catch block falling back to DEMO_USERS on database failure'
  },
  {
    regex: /catch\s*\(\s*dbErr\s*\)[\s\S]*?=\s*\{\s*id:/i,
    description: 'Catch block returning mock object on database failure'
  },
  {
    regex: /catch\s*\(\s*\w*\s*\)[\s\S]*?using mock token fallback/i,
    description: 'Silently falling back to mock QBO token on token exchange failure'
  }
];

const EXCLUDED_FILES = ['verifyAll.ts', 'mockData.ts'];

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

function runAudit() {
  const allFiles = [...walkDir('src'), 'server.ts'];
  let violationsFound = 0;

  for (const filePath of allFiles) {
    if (EXCLUDED_FILES.some(ex => filePath.endsWith(ex))) {
      continue;
    }
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.js') && !filePath.endsWith('.tsx')) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(content)) {
        console.error(`[Guardrail Violation] Found forbidden pattern in ${filePath}: ${pattern.description}`);
        violationsFound++;
      }
    }
  }

  if (violationsFound > 0) {
    console.error(`\n❌ Found ${violationsFound} violation(s) of runtime fallback/mock data policies.`);
    process.exit(1);
  } else {
    console.log('✅ No unauthorized runtime fallback or mock data patterns detected.');
    process.exit(0);
  }
}

runAudit();
