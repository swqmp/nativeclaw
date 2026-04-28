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
  {
    name: 'bridge templates do not hardcode one installed agent identity',
    run() {
      const forbidden = [
        /\bWhet\b/,
        /\bJamiah\b/,
        /\bNJDev\b/,
        /NJ Developments/,
        /-Users-iamiahbartlett--claude-workspace/,
      ];
      return forbidden.filter((pattern) => pattern.test(source)).map((pattern) => `found ${pattern}`);
    },
  },
  {
    name: 'subprocesses receive NativeClaw path environment',
    run() {
      const patterns = [
        /function nativeClawEnv/,
        /NATIVECLAW_WORKSPACE/,
        /NATIVECLAW_PROJECT_DIR/,
        /NATIVECLAW_KEYCHAIN_ACCOUNT/,
        /runCronCommand[\s\S]+nativeClawEnv\(\)/,
      ];
      return patterns.filter((pattern) => !pattern.test(source)).map((pattern) => `missing ${pattern}`);
    },
  },
  {
    name: 'Codex transcript extractor reads user-typed inputs from event_msg.user_message',
    run() {
      const patterns = [
        /ev\.type === 'event_msg'/,
        /payload\.type === 'user_message'/,
        /payload\.message/,
      ];
      return patterns.filter((pattern) => !pattern.test(source)).map((pattern) => `missing ${pattern}`);
    },
  },
  {
    name: 'buildGapTranscript replaces summary+replay path and applies hard cap',
    run() {
      const patterns = [
        /function buildGapTranscript\(sourceBackend, sessionKey, sinceISO\)/,
        /const GAP_CAP_CHARS = \d+/,
        /while \(totalChars > GAP_CAP_CHARS && exchanges\.length > 1\)/,
        /# GAP TRANSCRIPT/,
        /# END GAP TRANSCRIPT/,
        /formatGapTimestamp\(/,
      ];
      return patterns.filter((p) => !p.test(source)).map((p) => `missing ${p}`);
    },
  },
  {
    name: 'gap-boundary state (arrivedAt) is back-filled and updated by helpers',
    run() {
      const patterns = [
        /arrivedAt: \{\},/,
        /state\.arrivedAt\s*=\s*\{\}/,
        /function getBackendArrival\(chatId, backend\)/,
        /function markBackendArrival\(chatId, backend, when\)/,
        /function clearBackendArrival\(chatId, backend\)/,
        /clearBackendArrival\(chatId, kind\)/,
      ];
      return patterns.filter((p) => !p.test(source)).map((p) => `missing ${p}`);
    },
  },
  {
    name: 'slash /codex and /claude mark backend arrival after switch',
    run() {
      const patterns = [
        /markBackendArrival\(sessionKey, 'codex'\)/,
        /markBackendArrival\(sessionKey, 'claude'\)/,
      ];
      return patterns.filter((p) => !p.test(source)).map((p) => `missing ${p}`);
    },
  },
  {
    name: 'gap injection callers log explicitly when transcript is empty',
    run() {
      const patterns = [
        /No claude→codex (full )?gap to inject/,
        /No codex→claude (full )?gap to inject/,
        /Transfer claude→codex gap empty/,
        /Transfer codex→claude gap empty/,
      ];
      return patterns.filter((p) => !p.test(source)).map((p) => `missing ${p}`);
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
