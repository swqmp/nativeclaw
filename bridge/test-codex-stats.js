#!/usr/bin/env node

const assert = require('assert');
const {
  formatStatsContextLines,
  normalizeCodexTokenInfo,
  contextTokensFromUsage,
} = require('./stats-format');

const info = {
  total_token_usage: {
    input_tokens: 2305723,
    cached_input_tokens: 2113536,
    output_tokens: 13575,
    reasoning_output_tokens: 5150,
    total_tokens: 2319298,
  },
  last_token_usage: {
    input_tokens: 150313,
    cached_input_tokens: 148864,
    output_tokens: 529,
    reasoning_output_tokens: 431,
    total_tokens: 150842,
  },
  model_context_window: 258400,
};

const usage = normalizeCodexTokenInfo(info);
assert.strictEqual(usage.contextTokens, 150842);
assert.strictEqual(usage.inputTokens, 150313);
assert.strictEqual(usage.commandTotalTokens, 2319298);
assert.strictEqual(contextTokensFromUsage(usage, 'codex'), 150842);

const lines = formatStatsContextLines({
  backend: 'codex',
  model: 'gpt-5.5',
  contextWindow: 258400,
  usage,
});

assert.deepStrictEqual(lines, [
  '  Context window: 258.4k',
  '  Current context: 150.8k / 258.4k (58.4%)',
]);

console.log('codex stats tests passed');
