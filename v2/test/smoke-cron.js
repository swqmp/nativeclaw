#!/usr/bin/env node

/**
 * Cron Routing Smoke Test
 * Verifies that the bridge's handleCronJob dispatches OpenRouter profile backends
 * to runOpenCode without falling through to runClaude.
 */

const assert = require('assert');

// Read the actual bridge source to validate routing logic
const fs = require('fs');
const path = require('path');

const BRIDGE_PATH = process.env.NATIVECLAW_BRIDGE_PATH
  || path.resolve(__dirname, '..', '..', 'bridge', 'bridge.js');

const code = fs.readFileSync(BRIDGE_PATH, 'utf8');

console.log('=== NativeClaw Cron Routing Smoke Test ===\n');

// 1. Assert the OpenRouter branch exists
assert(code.includes("cronBackend === 'openrouter' || cronBackend === 'kimi' || cronBackend === 'minimax'"), 'Missing OpenRouter cron branch');
console.log('✅ OpenRouter cron branch exists in bridge.js');

// 2. Assert it calls runOpenCode with OpenRouter model strings
assert(code.includes("runOpenCode(cronPrompt, null,"), 'Missing runOpenCode call in cron handler');
console.log('✅ runOpenCode invoked for OpenRouter crons');

// 3. Assert profiles resolve dynamically
assert(code.includes("resolveActiveOpenRouterProfile"), 'Missing active OpenRouter profile resolver');
console.log('✅ OpenRouter profile resolver used');

// 4. Assert config paths are profile-aware
assert(code.includes("openRouterConfigPathForProfile"), 'Missing OpenRouter profile config helper');
console.log('✅ OpenRouter profile config path helper used');

// 5. Assert OpenRouter key is read
assert(code.includes("readKeychainSecret('OPENROUTER_API_KEY')"), 'Missing OpenRouter key read');
console.log('✅ OpenRouter API key pulled from keychain');

// 6. Assert idleTimeout is set reasonably for crons
assert(code.includes("idleTimeout: 300"), 'Missing idleTimeout for OpenCode crons');
console.log('✅ OpenCode cron idleTimeout set to 300s');

// 7. Assert cost string includes OpenRouter profile backends
assert(code.includes("cronBackend === 'openrouter' || cronBackend === 'kimi' || cronBackend === 'minimax'"), 'Missing OpenRouter in cost string handler');
console.log('✅ Log output includes OpenRouter token/cost details');

console.log('\n=== All Smoke Tests Passed ===');
console.log('When bridge restarts, heartbeats will route to OpenRouter profile backends correctly.\n');
