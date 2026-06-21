# NativeClaw OpenRouter Backend Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded Kimi/MiniMax split with a generic OpenRouter lane, then clean the v2 docs, tests, defaults, compaction, settings, wizard, and build artifacts so the repo matches what actually ships.

**Architecture:** NativeClaw should keep first-class native lanes for Claude and Codex, then expose OpenRouter as a configurable third lane with named profiles. Kimi, MiniMax, Grok, and any future model become profiles on that lane, not separate backend branches scattered through bridge code. The bridge validates model IDs through OpenRouter's Models API, derives context windows and supported parameters from metadata when possible, and stores provider routing preferences in config.

**Tech Stack:** Node bridge, OpenCode CLI, OpenRouter API, TypeScript v2 package, JSON config, existing launchd/systemd/Task Scheduler install paths.

---

## Current Verified State

- Live bridge restart loaded the patched code.
- Codex false context bug is fixed: the log cleared a stale compaction flag because actual context was `86,060`, below the `250,000` threshold.
- Separate problem remains: byte-size rollover still cleared a Codex thread after the stale context flag was fixed.
- Repo and live bridge currently hardcode `KIMI_MODEL = 'moonshotai/kimi-k2.6'` and `MINIMAX_MODEL = 'minimax/minimax-m2.7'`.
- v2 docs/tests/default config still mention Grok as if it is the fourth backend, while live code has MiniMax.
- `v2/scripts/verify.js` still requires deleted modules: `lib/skills-extractor.ts` and `lib/voice-handler.ts`.
- `v2/lib/compaction.ts` is stale: Kimi/Grok thresholds, fake `newSessionId`, old OpenCode event parser, file-writing shortcut, and not wired to live inline compaction.
- Settings UI token shutdown behavior and wizard keychain account portability still need audit/fix.
- `dist/` has generated/source drift and newly added OpenCode config files need a policy decision.

## Source Constraints

- OpenRouter model identifiers are model `id` values returned by `GET https://openrouter.ai/api/v1/models`.
- The Models API returns metadata including `id`, `canonical_slug`, `context_length`, pricing, top provider context/max output, and `supported_parameters`.
- OpenRouter provider routing supports `order`, `allow_fallbacks`, `only`, `ignore`, `sort`, `preferred_min_throughput`, `preferred_max_latency`, `max_price`, and related fields.
- If we need exact provider slugs, OpenRouter's docs say to use provider names from the model page.

## Product Decision

Use "OpenRouter profile" terminology, not "tag".

User-facing examples:

```text
/or set kimi moonshotai/kimi-k2.6
/or set minimax minimax/minimax-m2.7
/or set custom anthropic/claude-sonnet-4.5
/or profile kimi
/or providers kimi --order Fireworks,Morph,SambaNova --fallbacks off
/or list
```

Keep convenience aliases:

```text
/kimi    -> /or profile kimi
/minimax -> /or profile minimax
/grok    -> /or profile grok, only if configured
```

This gives power users model flexibility without making normal users learn OpenRouter config immediately.

## Phase 1: Config Schema and Model Registry

**Files:**
- Create: `projects/nativeclaw/v2/lib/openrouter-profiles.ts`
- Modify: `projects/nativeclaw/bridge/bridge.js`
- Modify: `~/.claude/telegram-bridge/bridge.js`
- Modify: `projects/nativeclaw/v2/static/default-config.json`
- Test: `projects/nativeclaw/v2/test/test-openrouter-profiles.js`

**Step 1: Write failing tests**

Add tests for:
- built-in profiles resolve to model IDs.
- custom profiles preserve model ID, display name, provider routing, and compaction threshold.
- metadata fallback works when OpenRouter API is unavailable.
- invalid model IDs produce a clear error before spawning OpenCode.

Run:

```bash
cd projects/nativeclaw/v2
node test/test-openrouter-profiles.js
```

Expected: fail because the module does not exist.

**Step 2: Implement profile module**

Add:

```ts
export type OpenRouterProfile = {
  name: string;
  model: string;
  display?: string;
  configPath?: string;
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    sort?: string | { by: string; partition?: string };
    preferred_min_throughput?: number;
    preferred_max_latency?: number;
    max_price?: { prompt?: number; completion?: number };
  };
  contextWindow?: number;
  compactionThreshold?: number;
};
```

Keep built-in defaults for `kimi`, `minimax`, and optional `grok`, but store them in one place.

**Step 3: Add model metadata lookup**

Implement a small cache around:

```text
GET https://openrouter.ai/api/v1/models
```

Cache file:

```text
~/.claude/telegram-bridge/openrouter-models-cache.json
```

TTL:

```text
24 hours
```

Use metadata for:
- `context_length`
- `supported_parameters`
- display name
- pricing

**Step 4: Replace hardcoded constants**

In bridge code, replace direct `KIMI_MODEL` and `MINIMAX_MODEL` logic with:

```js
const OPENROUTER_PROFILES = loadOpenRouterProfiles(config);
const activeProfile = resolveOpenRouterProfile(state.openRouterProfile || 'kimi');
```

Aliases should call the profile resolver, not duplicate route logic.

**Step 5: Verify**

Run:

```bash
node --check ~/.claude/telegram-bridge/bridge.js
node --check projects/nativeclaw/bridge/bridge.js
cd projects/nativeclaw/v2 && npm run build
cd projects/nativeclaw/v2 && node test/test-openrouter-profiles.js
```

Expected: all pass.

## Phase 2: Slash Commands and Settings UI

**Files:**
- Modify: `projects/nativeclaw/bridge/bridge.js`
- Modify: `~/.claude/telegram-bridge/bridge.js`
- Modify: `projects/nativeclaw/v2/bin/settings`
- Modify: `projects/nativeclaw/v2/static/templates/settings.html`
- Test: `projects/nativeclaw/bridge/eval-slash-commands.js`
- Test: `projects/nativeclaw/v2/test/smoke-settings.js`

**Step 1: Add slash command tests**

Required command behavior:

```text
/or list
/or profile <name>
/or set <name> <model-id>
/or providers <name> --order A,B,C --fallbacks on|off
/or info <name>
/kimi
/minimax
/grok
```

Expected:
- aliases set `activeBackend=openrouter` plus `openRouterProfile=<name>`.
- `/stats` shows model and profile.
- bad model IDs fail with a clear error.

**Step 2: Implement command parsing**

Keep parsing simple:
- no dependency-heavy CLI parser.
- comma-split `--order`.
- booleans for `--fallbacks`.

**Step 3: Add Settings UI controls**

Add an "OpenRouter" tab:
- API key status.
- profile list.
- model ID input.
- display name input.
- provider order input.
- fallback toggle.
- throughput/latency/max price fields.
- validate button that hits Models API.

**Step 4: Verify**

Run:

```bash
cd projects/nativeclaw/v2 && node test/smoke-settings.js
node projects/nativeclaw/bridge/eval-slash-commands.js
```

Expected: no stale Kimi/Grok hardcoded failures.

## Phase 3: Compaction and Rollover Cleanup

**Files:**
- Modify: `projects/nativeclaw/bridge/bridge.js`
- Modify: `~/.claude/telegram-bridge/bridge.js`
- Modify or delete: `projects/nativeclaw/v2/lib/compaction.ts`
- Modify: `projects/nativeclaw/v2/index.ts`
- Test: new `projects/nativeclaw/v2/test/test-compaction-policy.js`

**Step 1: Decide module ownership**

Choose one:
- Preferred: delete `v2/lib/compaction.ts` from exported package and treat bridge inline compaction as the source of truth for v2.0.
- Alternative: extract the live bridge compaction into the module completely, with tests.

Recommendation: delete/defer the module for v2.0. The current file is not trustworthy enough to keep exported.

**Step 2: Fix Codex rollover policy**

Current byte-size rollover can clear threads even when token context is healthy. Change policy:
- token-based threshold is primary.
- byte-size rollover is only a safety valve at a much higher size, or only when parsing the rollout fails repeatedly.
- never clear a healthy Codex thread solely because JSONL is verbose from tool output.

**Step 3: Add tests**

Cases:
- Codex JSONL huge but context under threshold does not roll over.
- Codex context over threshold flags compaction.
- stale compaction flag clears when actual context is under threshold.
- OpenRouter profile with missing context uses conservative fallback.

**Step 4: Verify**

Run:

```bash
node --check ~/.claude/telegram-bridge/bridge.js
cd projects/nativeclaw/v2 && npm run build
cd projects/nativeclaw/v2 && node test/test-compaction-policy.js
```

Expected: all pass.

## Phase 4: Docs, Defaults, and Verifier Truth Pass

**Files:**
- Modify: `projects/nativeclaw/README.md`
- Modify: `projects/nativeclaw/v2/README.md`
- Modify: `projects/nativeclaw/v2/CHANGELOG.md`
- Modify: `projects/nativeclaw/v2/static/default-config.json`
- Modify: `projects/nativeclaw/v2/scripts/verify.js`
- Modify: `projects/nativeclaw/v2/test/smoke-cron.js`
- Modify: `projects/nativeclaw/v2/test/test-cron-routing.js`
- Remove or archive: `projects/nativeclaw/v2/OVERNIGHT_SUMMARY.md`

**Step 1: Make docs match product**

Replace "Kimi/Grok lanes" with:

```text
Claude, Codex, and OpenRouter profiles.
```

Mention Kimi, MiniMax, and Grok as example profiles only.

**Step 2: Fix defaults**

Update `default-config.json`:
- `voiceProvider` from `groq` to `xai`.
- `voiceModel` from `whisper-large-v3` to `grok-stt`.
- add `openRouterProfiles`.
- remove stale hardcoded Grok compaction defaults unless Grok is shipped as a profile.

**Step 3: Fix verifier**

Remove deleted files from `REQUIRED`:
- `lib/skills-extractor.ts`
- `lib/voice-handler.ts`

Add real required files:
- `lib/openrouter-profiles.ts`, if created.
- relevant OpenRouter default config files, if shipped.

**Step 4: Fix cron tests**

Tests should assert OpenRouter branch behavior generically:
- active backend `openrouter`.
- profile resolves model.
- cron uses `runOpenCode`.
- OpenRouter key is read.

Do not assert stale `grok` literals unless Grok is configured in the fixture.

**Step 5: Verify**

Run:

```bash
cd projects/nativeclaw/v2 && npm test
cd projects/nativeclaw/v2 && npm run verify
cd projects/nativeclaw/v2 && npm run build
node projects/nativeclaw/bridge/eval-slash-commands.js
```

Expected: all pass or only documented nonblocking checks remain.

## Phase 5: Security and Portability Pass

**Files:**
- Modify: `projects/nativeclaw/v2/bin/settings`
- Modify: `projects/nativeclaw/v2/wizard/server.ts`
- Modify: `projects/nativeclaw/v2/lib/credentials.ts`
- Test: `projects/nativeclaw/v2/test/smoke-settings.js`
- Test: new `projects/nativeclaw/v2/test/test-credentials-portability.js`

**Step 1: Settings token shutdown**

Ensure:
- random token is stored only in memory.
- token is invalid after shutdown.
- idle shutdown clears token and closes server.
- browser URL cannot be reused after shutdown.

**Step 2: Wizard account portability**

Replace hardcoded keychain account `whet` with:
- configured `agentName`, normalized.
- fallback `nativeclaw`.
- migration support for existing `whet` on this machine.

**Step 3: Credential command safety**

Audit `credentials.ts` shell calls:
- avoid string interpolation where possible.
- use `execFileSync` for `security`, `secret-tool`, and platform commands where practical.
- never log secrets.

**Step 4: Verify**

Run:

```bash
cd projects/nativeclaw/v2 && node test/smoke-settings.js
cd projects/nativeclaw/v2 && node test/test-credentials-portability.js
cd projects/nativeclaw/v2 && npm run build
```

Expected: all pass.

## Phase 6: Dist and Release Hygiene

**Files:**
- Modify: `projects/nativeclaw/.gitignore`
- Modify: `projects/nativeclaw/v2/package.json`
- Modify: `projects/nativeclaw/v2/tsconfig.json`
- Possibly remove: `projects/nativeclaw/v2/dist/**`

**Step 1: Choose dist policy**

Recommendation:
- do not commit `dist/` for normal repo source.
- build during publish/install.
- if GitHub releases need artifacts, attach built tarballs instead.

**Step 2: Clean generated drift**

If dist is not committed:

```bash
git rm -r projects/nativeclaw/v2/dist
```

Only run after Jamiah approves, because this is a destructive git operation.

If dist stays committed:

```bash
cd projects/nativeclaw/v2
npm run build
```

Then review exact generated diff.

**Step 3: Verify clean tree policy**

Run:

```bash
git -C projects/nativeclaw status --short
cd projects/nativeclaw/v2 && npm run build && npm test && npm run verify
```

Expected: source and generated output policy is explicit and reproducible.

## Execution Order

1. OpenRouter profile schema and resolver.
2. Slash commands and Settings UI.
3. Compaction and Codex byte-rollover cleanup.
4. Docs/defaults/tests/verifier truth pass.
5. Security/portability pass.
6. Dist/release hygiene.

## Acceptance Criteria

- `/stats` shows accurate context for Claude, Codex, and OpenRouter profiles.
- `/or list`, `/or profile`, `/or set`, `/kimi`, and `/minimax` work.
- Users can paste a current OpenRouter model ID without code edits.
- Provider routing is configurable per profile.
- Tests no longer assert Kimi/Grok when the code ships Kimi/MiniMax.
- `npm run build`, `npm test`, `npm run verify`, and `node bridge/eval-slash-commands.js` pass or produce only documented external-environment skips.
- Docs describe the same backend architecture the bridge actually runs.
- Bridge restart is the only runtime step after code changes; no self-restart from the agent.

## Commit Plan

Do not commit until Jamiah approves.

Suggested commit boundaries:

1. `feat: add openrouter backend profiles`
2. `feat: configure openrouter profiles from slash commands and settings`
3. `fix: make compaction and rollover token-aware`
4. `test: refresh nativeclaw v2 verification harness`
5. `docs: align v2 with openrouter profile architecture`
6. `chore: clean v2 release artifacts`
