#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { execSync } = require('child_process');

// Get staged files
const stagedFiles = process.argv.slice(2);

if (stagedFiles.length === 0) {
  console.log('No staged files to lint');
  process.exit(0);
}

// Separate files by type
const jsFiles = stagedFiles.filter(f => /\.(js|jsx|ts|tsx)$/.test(f));
const formatFiles = stagedFiles.filter(f => /\.(js|jsx|ts|tsx|json|md|yml|yaml)$/.test(f));

try {
  // Run ESLint on JS/TS files
  if (jsFiles.length > 0) {
    console.log('Running ESLint...');
    execSync(`npx eslint --fix ${jsFiles.join(' ')}`, { stdio: 'inherit' });
  }

  // Run Prettier on all applicable files
  if (formatFiles.length > 0) {
    console.log('Running Prettier...');
    execSync(`npx prettier --write ${formatFiles.join(' ')}`, { stdio: 'inherit' });
  }

  console.log('✅ Linting complete!');
} catch {
  console.error('❌ Linting failed');
  process.exit(1);
}