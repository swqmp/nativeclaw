#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const bridgePath = path.join(__dirname, 'bridge.js');
const source = fs.readFileSync(bridgePath, 'utf8');

const checks = [
  {
    name: 'minimal slash command matrix is documented in /help',
    run() {
      const required = [
        '/help',
        '/status',
        '/session',
        '/restart',
        '/stats',
        '/reset',
        '/fresh',
        '/effort',
        '/verbosity',
        '/codex',
        '/claude',
        '/codex --full',
        '/claude --full',
        '/opus',
        '/sonnet',
        '/haiku',
        '/5.4',
        '/5.4-mini',
      ];
      return required.filter((cmd) => !source.includes(cmd));
    },
  },
  {
    name: '/fresh is explicitly documented as an alias of /reset',
    run() {
      return /\/fresh.*alias.*\/reset|\/fresh.*same as.*\/reset/i.test(source) ? [] : ['missing alias wording'];
    },
  },
  {
    name: 'effort command maps to current Claude and Codex CLI controls',
    run() {
      const patterns = [
        /case '\/effort'/,
        /--effort/,
        /model_reasoning_effort/,
        /max:\s*'xhigh'/,
      ];
      const failures = patterns.filter((pattern) => !pattern.test(source)).map((pattern) => `missing ${pattern}`);
      if (/max-thinking-tokens/.test(source)) failures.push('stale --max-thinking-tokens flag still present');
      return failures;
    },
  },
  {
    name: 'Codex verbosity command maps to model_verbosity config',
    run() {
      const patterns = [
        /case '\/verbosity'/,
        /model_verbosity/,
        /CODEX_VERBOSITY_LEVELS/,
      ];
      return patterns.filter((pattern) => !pattern.test(source)).map((pattern) => `missing ${pattern}`);
    },
  },
  {
    name: 'handoff summaries use Sonnet, not Haiku',
    run() {
      return source.includes("const HANDOFF_SUMMARY_MODEL = 'sonnet'") ? [] : ['missing HANDOFF_SUMMARY_MODEL sonnet constant'];
    },
  },
  {
    name: 'handoff prompt requires latest user and assistant messages verbatim',
    run() {
      const patterns = [
        /latest user message/i,
        /latest assistant (answer|message)/i,
        /verbatim/i,
      ];
      return patterns.filter((pattern) => !pattern.test(source)).map((pattern) => `missing ${pattern}`);
    },
  },
  {
    name: 'handoff prompt requires exact short answers and test phrases',
    run() {
      const patterns = [
        /short answers/i,
        /test phrases/i,
        /tokens/i,
      ];
      return patterns.filter((pattern) => !pattern.test(source)).map((pattern) => `missing ${pattern}`);
    },
  },
  {
    name: 'Codex transcript extractor filters injected context while preserving real messages',
    run() {
      const patterns = [
        /function extractCodexTranscriptExchanges/,
        /startsWith\('# CODEX BACKEND'\)/,
        /startsWith\('# HANDOFF BRIEF'\)/,
        /startsWith\('# STANDING CONTEXT'\)/,
        /exchanges\.push\(\{ role, text:/,
      ];
      return patterns.filter((pattern) => !pattern.test(source)).map((pattern) => `missing ${pattern}`);
    },
  },
];

let failed = 0;
for (const check of checks) {
  const failures = check.run();
  if (failures.length > 0) {
    failed += 1;
    console.error(`FAIL ${check.name}`);
    for (const failure of failures) console.error(`  - ${failure}`);
  } else {
    console.log(`PASS ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${checks.length} checks failed`);
  process.exit(1);
}

console.log(`\n${checks.length}/${checks.length} checks passed`);
