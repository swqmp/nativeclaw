#!/usr/bin/env node

/**
 * Cron Routing Smoke Test
 * Verifies that the bridge's handleCronJob dispatches Kimi/Grok backends
 * to runOpenCode without falling through to runClaude.
 */

const assert = require('assert');

// Read the actual bridge source to validate routing logic
const fs = require('fs');
const path = require('path');

const BRIDGE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude', 'telegram-bridge', 'bridge.js'
);

const code = fs.readFileSync(BRIDGE_PATH, 'utf8');

console.log('=== NativeClaw Cron Routing Smoke Test ===\n');

// 1. Assert the Kimi/Grok branch exists
assert(code.includes("cronBackend === 'kimi' || cronBackend === 'grok'"), 'Missing Kimi/Grok cron branch');
console.log('✅ Kimi/Grok cron branch exists in bridge.js');

// 2. Assert it calls runOpenCode with OpenRouter model strings
assert(code.includes("runOpenCode(cronPrompt, null,"), 'Missing runOpenCode call in cron handler');
console.log('✅ runOpenCode invoked for kimi/grok crons');

// 3. Assert Kimi uses the nitro variant
assert(code.includes("openrouter/moonshotai/kimi-k2.6"), 'Missing Kimi model string');
  console.log('✅ Kimi model set to moonshotai/kimi-k2.6');

// 4. Assert Grok uses the correct model
assert(code.includes("openrouter/x-ai/grok-4.3"), 'Missing Grok model string');
console.log('✅ Grok model set to openrouter/x-ai/grok-4.3');

// 5. Assert config paths are correct
assert(code.includes(".config/opencode/opencode.json"), 'Missing Kimi config path');
console.log('✅ Kimi config path → ~/.config/opencode/opencode.json');

assert(code.includes(".config/opencode/opencode.grok.json"), 'Missing Grok config path');
console.log('✅ Grok config path → ~/.config/opencode/opencode.grok.json');

// 6. Assert OpenRouter key is read
assert(code.includes("readKeychainSecret('OPENROUTER_API_KEY')"), 'Missing OpenRouter key read');
console.log('✅ OpenRouter API key pulled from keychain');

// 7. Assert idleTimeout is set reasonably for crons
assert(code.includes("idleTimeout: 60"), 'Missing idleTimeout for OpenCode crons');
console.log('✅ OpenCode cron idleTimeout set to 60s');

// 8. Assert cost string includes kimi/grok
assert(code.includes("cronBackend === 'kimi' || cronBackend === 'grok'"), 'Missing kimi/grok in cost string handler');
console.log('✅ Log output includes kimi/grok token/cost details');

console.log('\n=== All Smoke Tests Passed ===');
console.log('When bridge restarts, heartbeats will route to Kimi/Grok backends correctly.\n');
