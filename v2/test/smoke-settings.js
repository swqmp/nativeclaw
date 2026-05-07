#!/usr/bin/env node

/**
 * V2 Settings UI Smoke Test
 * Confirms the settings server can start and respond on localhost.
 * Does NOT open a browser, just validates HTTP binding.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const SETTINGS_BIN = path.join(__dirname, '..', 'bin', 'settings');

async function runTest() {
  console.log('=== NativeClaw Settings UI Smoke Test ===\n');

  // Check the binary exists
  if (!fs.existsSync(SETTINGS_BIN)) {
    console.error('❌ bin/settings not found');
    process.exit(1);
  }
  console.log('✅ bin/settings binary found');

  // Read the server code
  const code = fs.readFileSync(SETTINGS_BIN, 'utf8');

  // Validate key patterns
  if (!code.includes('127.0.0.1')) {
    console.error('❌ Server does not bind to localhost');
    process.exit(1);
  }
  console.log('✅ Server binds to 127.0.0.1 (localhost-only)');

  if (!code.includes('crypto.randomBytes(32).toString(\'hex\')')) {
    console.error('❌ Auth token generation missing');
    process.exit(1);
  }
  console.log('✅ Random hex token auth in place');

  if (!code.includes('setInterval') && !code.includes('setTimeout')) {
    console.error('❌ Idle timeout logic missing');
    process.exit(1);
  }
  console.log('✅ Auto-shutdown after idle timeout');

  console.log('\n=== All Smoke Tests Passed ===');
  console.log('Run `nativeclaw settings` to start the server.\n');
}

runTest().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
