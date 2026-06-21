#!/usr/bin/env node

/**
 * NativeClaw v2.0 Verification Script
 * Ensures all expected files and directories exist.
 * Usage: node scripts/verify.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const REQUIRED = [
  'bin/nativeclaw',
  'bin/setup',
  'bin/settings',
  'bin/backup',
  'bin/doctor',
  'bin/status',
  'bin/bridge-wrapper',
  'bin/logs',
  'docs/INSTALL.md',
  'docs/TROUBLESHOOTING.md',
  'docs/DAVID_TEST_PLAN.md',
  'lib/subagent-delegation.ts',
  'lib/credentials.ts',
  'lib/bridge-checkpoint.ts',
  'lib/openrouter-profiles.ts',
  'wizard/setup-core.ts',
  'wizard/server.ts',
  'install/install.ps1',
  'install/install.sh',
  'windows/nativeclaw-task.xml',
  'systemd/nativeclaw.service',
  'static/default-config.json',
  'static/default-mcp-config.json',
  'static/default-cron-schedule.json',
  'static/templates/settings.html',
  'index.ts',
  'package.json',
  'tsconfig.json',
  'README.md',
  'CHANGELOG.md',
  'VERSION',
];

let exitCode = 0;

console.log('\n⚡ NativeClaw v2.0 Verification\n');

for (const rel of REQUIRED) {
  const full = path.join(ROOT, rel);
  const exists = fs.existsSync(full);
  const status = exists ? '✅' : '❌';
  if (!exists) exitCode = 1;
  console.log(`${status}  ${rel}`);
}

console.log('\n' + (exitCode === 0
  ? 'All required files present.'
  : 'Some files are missing — run `npm run build` or reinstall.'));

process.exit(exitCode);
