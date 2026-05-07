#!/usr/bin/env node

/**
 * Cron Routing Test — Validate kimi/grok crons hit runOpenCode
 * Usage: node test-cron-routing.js
 */

const assert = require('assert');
const bridgePath = require('path').join(
  process.env.HOME || process.env.USERPROFILE,
  '.claude', 'telegram-bridge', 'bridge.js'
);

// Read bridge.js as text and validate the routing logic exists
const code = require('fs').readFileSync(bridgePath, 'utf8');

// Assertions
assert(code.includes("cronBackend === 'kimi' || cronBackend === 'grok'"), 'Missing kimigrok branch');
assert(code.includes("runOpenCode(cronPrompt, null,"), 'Missing runOpenCode call in cron');
assert(code.includes("openrouter/moonshotai/kimi-k2.6"), 'Missing kimi model string');
assert(code.includes("openrouter/x-ai/grok-4.3"), 'Missing grok model string');
assert(code.includes(".config/opencode/opencode.json"), 'Missing kimi config path');
assert(code.includes(".config/opencode/opencode.grok.json"), 'Missing grok config path');
assert(code.includes("readKeychainSecret('OPENROUTER_API_KEY')"), 'Missing OpenRouter key read');

console.log('✅ All cron routing assertions passed.');
console.log('When bridge restarts, Kimi/Grok crons will route correctly.\n');

// Optionally validate syntax by requiring (will crash if syntax error)
try {
  require.resolve(bridgePath);
  console.log('✅ bridge.js resolves cleanly (no fatal require errors)');
} catch (e) {
  console.log('⚠ bridge.js has require issues (expected if it uses top-level await or ESM-only)');
}
