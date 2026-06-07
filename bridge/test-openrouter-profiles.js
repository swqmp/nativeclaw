#!/usr/bin/env node

const assert = require('assert');
const {
  DEFAULT_OPENROUTER_PROFILES,
  normalizeModelId,
  resolveOpenRouterProfile,
  upsertOpenRouterProfile,
  parseProviderOrder,
} = require('./openrouter-profiles');

assert.strictEqual(normalizeModelId('openrouter/moonshotai/kimi-k2.6'), 'moonshotai/kimi-k2.6');
assert.strictEqual(normalizeModelId(' minimax/minimax-m2.7 '), 'minimax/minimax-m2.7');
assert.throws(() => normalizeModelId('not-a-model'), /provider\/model/);

const kimi = resolveOpenRouterProfile('kimi', {});
assert.strictEqual(kimi.name, 'kimi');
assert.strictEqual(kimi.model, 'moonshotai/kimi-k2.6');
assert.strictEqual(kimi.modelWithProvider, 'openrouter/moonshotai/kimi-k2.6');
assert.deepStrictEqual(kimi.provider.order, DEFAULT_OPENROUTER_PROFILES.kimi.provider.order);

const glm = resolveOpenRouterProfile('glm', {});
assert.strictEqual(glm.name, 'glm');
assert.strictEqual(glm.model, 'z-ai/glm-5.1');
assert.strictEqual(glm.contextWindow, 202752);
assert.strictEqual(glm.compactionThreshold, 160000);

const mimo = resolveOpenRouterProfile('mimo', {});
assert.strictEqual(mimo.name, 'mimo');
assert.strictEqual(mimo.model, 'xiaomi/mimo-v2.5-pro');
assert.strictEqual(mimo.contextWindow, 1048576);
assert.strictEqual(mimo.compactionThreshold, 350000);

const customProfiles = upsertOpenRouterProfile({}, 'fast', {
  model: 'openrouter/anthropic/claude-sonnet-4.5',
  display: 'Fast Sonnet',
  provider: { order: ['Fireworks'], allow_fallbacks: false },
});
const fast = resolveOpenRouterProfile('fast', { openRouterProfiles: customProfiles });
assert.strictEqual(fast.model, 'anthropic/claude-sonnet-4.5');
assert.strictEqual(fast.display, 'Fast Sonnet');
assert.deepStrictEqual(fast.provider.order, ['Fireworks']);
assert.strictEqual(fast.provider.allow_fallbacks, false);

assert.deepStrictEqual(parseProviderOrder(' Fireworks, Morph ,SambaNova '), ['Fireworks', 'Morph', 'SambaNova']);
assert.deepStrictEqual(parseProviderOrder(''), []);

console.log('openrouter profile tests passed');
