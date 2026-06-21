# NativeClaw v2.0 — Plan

**Status:** Scoped, not started · **Author:** Jamiah Bartlett (with Whet) · **Date:** 2026-04-29

A major release. v2.0 turns NativeClaw from "a CLI tool you set up in a terminal" into "an installable assistant with a visual setup flow and a persistent control panel." The core agent runtime stays the same — what changes is the surface around it.

---

## Why v2.0 (not v1.11)

The setup wizard alone would be a v1.11. Adding a persistent settings UI, backup/restore, diagnostic dump, and Windows support is a categorical jump in what the project ships. Power users still get `setup.sh` + raw JSON config. Non-technical users get a browser-based install + control panel. Both paths produce the same install.

This is the friction reduction we've been pointing at for months — making NativeClaw something Jamiah could actually post about and have non-developer friends successfully install.

---

## Goals

1. **Lower setup friction** for users who have never opened a terminal. Browser-driven install, prereqs auto-detected and installable in one click, OAuth handoffs that don't confuse anyone.
2. **Provide a persistent settings UI** so config edits don't require finding and editing JSON files.
3. **Cross-platform parity** — Mac, Linux, and Windows installs all work the same way. Windows is new.
4. **Backup/restore + diagnostic dump** so users don't lose their workspace on machine swaps, and can ship a useful bundle when something breaks.
5. **Preserve existing CLI path** — `setup.sh` stays as a first-class option for power users.

---

## Non-goals (explicitly out of v2.0)

- Skill marketplace
- Voice-out / TTS replies
- Group chat / multi-user installs
- Mobile-native app
- Public deploys (settings UI is **localhost-only**, hard line)
- Cron schedule LLM-natural-language editor (raw form editor only)

These come later if at all.

---

## Scope

### A. Setup wizard (`bash install.sh` → browser)

Single bash command kicks off a Node-based local server on `127.0.0.1:9292` (auto-pick next port if taken). Server runs the user through a six-page flow:

| # | Page | Content |
|---|------|---------|
| 1 | Welcome + prereq check | Detect Node, Claude CLI, Codex CLI; one-click install missing prereqs (streams output via SSE). |
| 2 | Backend choice | Claude only / Codex only / Both. One-line pricing context per option. |
| 3 | Agent identity | Agent name, user name, optional vibe template (3-4 SOUL.md presets — sharp / friendly / professional / custom). |
| 4 | Telegram connection | Paste bot token (validated via `getMe` before accepting), then "send a message to your bot" — page polls `getUpdates` and auto-detects chat ID. |
| 5 | Optional features | Toggles for QMD memory + voice transcription. Google Workspace deferred to settings UI Connections tab. |
| 6 | Install + verify | Live-streamed log: writes config, registers service, starts bridge, tests round-trip. Final state: "Send a message to your bot" + button that opens the bot's Telegram chat. |

#### OAuth handoff convention
Any step that requires a separate browser tab (Claude OAuth, Google OAuth) follows the same pattern:

1. Wizard shows: *"We'll open a new tab for [service] auth. Come back here when you see the success page and click Continue."*
2. New tab opens (target=_blank or window.open).
3. Wizard polls server endpoint that watches for the auth completion signal.
4. On success, wizard advances. On timeout, "didn't work? click here to retry."

This solves the "why is my wizard tab broken" problem if the OAuth callback redirect interferes with the wizard's session.

#### Stuck-step recovery
Every wizard step has three options:
- **Retry** — re-run the same action
- **Skip for now** — defer the step, log it, surface in settings UI later
- **Edit manually** — show the file path the user can edit themselves

No step blocks the wizard indefinitely. Errors surface the actual failure (not "see logs"), and provide an actionable next step.

### B. Settings UI (`nativeclaw settings`)

CLI command starts the server on demand at `127.0.0.1:9292`. Shuts down after 30 minutes idle. Same server, different routes from setup wizard. Inline help text for every field — clicking a "?" reveals one or two sentences of explanation.

Tabs:

| Tab | Contents |
|-----|----------|
| **Status** | Bridge alive/dead, MCP health, last cron run, `/usage` snapshot for Claude + Codex, last 5 messages timestamps |
| **Config** | Edit `bridge/config.json` fields with form validation (model, allowed chat IDs, agent/user names, effort, verbosity) |
| **MCP servers** | Toggle each MCP on/off, see auth status (keychain entry exists?), test each with one click |
| **Cron schedule** | Form-based editor for `cron-schedule.json` — add/remove/edit jobs, no raw JSON required |
| **Connections** | Google Workspace OAuth status + setup, Telegram bot info, voice transcription provider choice, QMD on/off, GitHub PAT |
| **Logs** | Tail recent `telegram-bridge.log` + one-click "Export diagnostic bundle" zip |
| **Backup / Restore** | Download workspace as zip; upload zip to restore on new machine. Excludes secrets. |

### C. Cross-platform support

| Platform | Service mgr | Path conventions | Keychain | Notes |
|----------|------------|------------------|----------|-------|
| macOS | launchd | `~/...` | `security` | Current primary; minimal change |
| Linux | systemd user | `~/...` | `secret-tool` (libsecret) | Already supported; validate parity |
| Windows | **Task Scheduler** | `%USERPROFILE%\...` | DPAPI / Credential Manager | **NEW.** Major lift. |

Windows specifics to figure out:
- PowerShell equivalents for `bash install.sh` and `bash setup.sh` — likely `install.ps1` / `setup.ps1`
- Task Scheduler XML generation in lieu of launchd plist or systemd unit
- Keychain abstraction layer in `mcp-wrapper.js` to use Credential Manager API on Windows
- File path normalization (forward vs backslash) across all bash scripts; migrate to Node-based scripts where path handling matters
- Node prereq install: assume user has Node, or auto-install via winget?
- Setup wizard launcher: `install.bat` that bootstraps Node and starts the server

### D. Backup/restore

- **Backup:** zip `workspace/` minus `.mcp.json`, `bridge/config.json` secrets, and `feedback/`/`memory/` if user opts. Default includes everything except `.mcp.json` and `bridge/config.json`. Output: `nativeclaw-backup-YYYY-MM-DD.zip`.
- **Restore:** upload zip, prompt user before overwriting any existing files. Useful for new-machine migration.
- **Excluded by default:** `.mcp.json` (contains secrets in env vars), `bridge/config.json` (bot token), `bridge/state.json` (machine-specific session state), `bridge/bridge.pid`.

### E. Diagnostic dump

One-click button in Logs tab. Bundles:
- Last 200 lines of `telegram-bridge.log`
- Sanitized `state.json` (session IDs redacted)
- `system/mcp-health/last-probe.json`
- `restart.log` last 100 lines
- `package.json`, Node version, OS version
- VERSION file
- Recent cron run history

Outputs `nativeclaw-diag-YYYY-MM-DD-HHMM.zip`. User DMs the zip to whoever is supporting them; no live SSH required.

---

### F. Agent Intelligence Features (Updated After v2.0 Ship)

Research into Hermes Agent + testing of OpenCode/NativeClaw hybrid architecture surfaced five priority features. After the May 9 audit, the v2.0/v2.1 split is:

| # | Feature | What it solves | Scope | Status |
|---|---------|-------------|-------|--------|
| 1 | **Skills auto-extraction** | After complex multi-step tasks, auto-craft reusable skills. | Bridge level | **Pulled** - bag-of-words implementation produced unusable output |
| 2 | **Context compaction (OpenRouter profiles)** | When an OpenRouter profile approaches context limit, summarize older history and start fresh with recap. | Bridge-owned inline compaction | **Shipped in v2.0** |
| 3 | **Subagent delegation fix** | Spawn background agents without blocking Telegram turns. | Bridge `spawnSubagent()` refactor + completion-watch loop | **Deferred to v2.1** |
| 4 | **Background review enhancement** | Periodic memory extraction pass. | Light subagent on existing backend | **Deferred** - AGENTS.md checkpoint discipline is enough for v2.0 |
| 5 | **Continuous background review** | Long-running subagent that watches session transcripts in near-realtime, captures decisions as they happen. | Independent worker process, not ride-along per turn | **Investigate → likely v2.1** |

**How context compaction works now:**

1. OpenRouter profile sessions run through OpenCode and are stored in OpenCode's SQLite session store
2. On each turn, bridge tracks turn usage and keeps the running session high-water mark
3. When approaching threshold:
   - **Kimi profile:** ~210K tokens by default
   - **MiniMax profile:** ~160K tokens by default
   - **Grok profile:** ~350K tokens by default
   - Custom profiles can set `contextWindow` and `compactionThreshold`
4. Bridge asks the active agent to write a checkpoint, then runs a sidecar summarizer
5. Bridge starts a fresh OpenCode session with standing context + structured recap
6. Claude and Codex remain native lanes. Codex rollover is token-aware; Claude uses its own native behavior plus bridge stats.

This is analogous to what Hermes calls "context compression," but adapted for our stateless-turn architecture.

---

### G. Hermes-derived research candidates (deferred to v2.1+)

| Candidate | What it is | Deferral reason |
|-----------|-----------|-----------------|
| **Honcho dialectic user modeling** | Self-hosted user-modeling layer alongside QMD | QMD already handles user profiling; Honcho adds a different style but not measurably better for our use case. Revisit if user-model quality becomes a blocker. |
| **Interrupt + redirect** | SIGTERM + auto-resume with redirect prefix | Pragmatic version (Ctrl+C + new message) already works via bridge. True mid-stream redirect adds code complexity without solving a frequent pain point. |
| **Session search w/ LLM summarization** | Hermes-style FTS5 + LLM cross-session recall | QMD handles this adequately. LLM-summarized cross-session search is richer but not urgent. |
| **Insights /usage aggregation** | `"$ spent today, which tools used most"` dashboard | Nice-to-have, not production-blocking. |


## Open research / decisions before shipping

### 1. Hermes-agent feature gate (Honcho / agentskills.io / interrupt+redirect)
Tonight's investigation produces a yes/no/defer decision per candidate. See Scope section F. Three candidates surfaced from Apr 28 research; final v2.0 inclusion pending the deeper dive. Trello card on Plans/Today bucket tracks the investigation task.

### 2. Voice transcription provider
Resolved for v2.0: xAI Grok STT is the default. OpenAI Whisper and local transcription remain fallback options.

### 3. Google Workspace OAuth client
- **Option A:** ship a NativeClaw-owned shared OAuth client; users authenticate against it. Lower friction, but Jamiah owns the audit trail and verification status.
- **Option B:** users create their own GCP project + OAuth client. Higher friction, full user ownership.

Decide before shipping the Connections tab. v2.0 likely ships with B and adds A later if user demand justifies.

### 4. Settings server lifetime + auth
- **Lifetime:** on-demand only (`nativeclaw settings` starts it; auto-shutdown after 30 min idle). No always-on daemon.
- **Auth:** random URL token in initial browser launch URL (not guessable by other local processes). Revoked when server shuts down.
- **Multi-user shared machines:** bind to user's loopback only, document the token model.

---

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| OAuth tab interactions break wizard session | Explicit handoff convention with "click Continue when you're back" UX |
| Prereq install fails (Homebrew missing, npm permissions) | Surface actual error, link to docs, allow retry, never lock the wizard |
| User closes wizard mid-setup | Server detects partial state in workspace files, resumes from last completed step |
| Localhost port already in use | Auto-pick next available port (9292, 9293, etc.) |
| Multi-user shared machine | Random URL token in browser launch URL; never expose to non-loopback |
| Server stays running, eats RAM | Auto-shutdown after idle timeout (30 min default, configurable) |
| Windows port harder than scoped | Phase Windows separately if needed; ship Mac/Linux v2.0 first if Windows blocks the timeline |
| Backup contains secrets | Default-exclude `.mcp.json` and `bridge/config.json`; let user opt in to include |
| Diagnostic dump leaks secrets | Sanitize state.json, never include `.mcp.json`; redact bot tokens in log tail |

---

## Test plan

### Primary test user
**David** (Jamiah's best friend, non-developer). Test scenarios:
1. Fresh install on his laptop with zero terminal experience. Does he reach a working bot in under 15 minutes?
2. First config edit (change agent name, tweak a cron). Does he do it in settings UI without help?
3. Backup, fresh install on a different machine, restore. Does it work end-to-end?
4. Something breaks. Does the diagnostic dump tell Jamiah what is wrong?

### Power-user smoke
**Whet (Jamiah's primary install)** — confirm `setup.sh` path still works for upgrading from v1.10.x to v2.0. Confirm settings UI doesn't break existing workspace customizations.

### Cross-platform validation
- Mac: Whet (M2 MacBook) — primary
- Linux: Mark (Omarchy / Tailscale) — secondary
- Windows: TBD — Jamiah to acquire access to a Windows machine, or borrow one for testing

---

## Implementation phases

The release is shipped as one big v2.0, but development happens in phases for sanity:

| Phase | Scope | Estimate |
|-------|-------|----------|
| 1 | Setup wizard server skeleton + 6-page happy path (Mac/Linux) | 1 wk |
| 2 | Error handling, retry/skip/manual, OAuth handoff convention | 3 days |
| 3 | Settings UI control panel — Status, Config, MCP, Cron tabs | 1 wk |
| 4 | Settings UI — Connections, Logs, Backup/Restore tabs | 4 days |
| 5 | Voice transcription research, recommendation, integration | 3 days |
| 6 | Windows port (install.ps1, Task Scheduler, DPAPI keychain shim) | 1-2 wks |
| 7 | David UX test, iterate on findings | 3-5 days |
| 8 | Docs, screenshots, screencast, README rewrite, v2.0 tag + release | 3 days |

**Realistic total:** 4-6 weeks of focused work. Could compress with parallel tracks.

---

## Migration path from v1.10.x

Existing installs upgrade via the v1.10.4 agent-driven flow (`check for updates` triggers it). The agent:
1. Detects v2.0 is available.
2. Walks user through changelog.
3. Existing `setup.sh`-based config files are preserved as-is.
4. Settings UI becomes available via `nativeclaw settings` (new CLI command).
5. User-content files (`SOUL.md`, `MEMORY.md`, etc.) are never touched.
6. VERSION file bumped to `v2.0.0`.

Power users who want nothing to change can ignore the wizard and settings UI entirely. They keep editing JSON like before.

---

## Success criteria

- [ ] David completes fresh install end-to-end without help in under 15 minutes
- [ ] David edits at least one config field via settings UI without touching JSON
- [ ] Backup/restore round-trip works on a different machine
- [ ] Diagnostic dump produces a usable bundle Jamiah can debug from
- [ ] All v1.10.x functionality preserved (existing `setup.sh` path still works)
- [ ] Cross-platform: confirmed working on Mac, Linux, Windows
- [ ] Voice transcription recommendation made, default chosen, alternatives surfaced
- [ ] Public README + screencast updated to show the wizard

---

## What happens next (immediate)

1. Park this plan as the source of truth for v2.0.
2. Resume normal v1.10.x maintenance. Bug fixes and small features go to v1.10.5+.
3. When ready to start v2.0, kick off Phase 1 with the wizard skeleton.
4. Voice transcription research can happen in parallel — it is a research item, not a code item.


---

## v2 Candidate Decision — Mode B Universal (added 2026-05-06)

**Open question for future architecture:** should NativeClaw standardize on OpenCode CLI as the single backend runner across Claude, Codex GPT, and OpenRouter profiles, enabling a single persistent `opencode serve` daemon that keeps MCPs warm for every turn regardless of model?

**Surfaced from:** the OpenCode migration prep (2026-05-06). Smoke test confirmed OpenCode handles all four model providers via OpenRouter, supports our 25 MCPs, has a clean JSON event schema, and ships `opencode serve` natively.

**Pros if adopted:**
- One CLI, one daemon, one MCP set across all lanes — eliminates the live/repo bridge drift
- Mode B (persistent server) becomes uniform — every lane gets warm MCPs and ~50ms TTFT instead of 10-30s cold start
- Consistent JSON schema = simpler bridge parser
- Native skill support across all lanes (Codex CLI doesn't read `~/.claude/skills/`, OpenCode does)

**Cons if adopted:**
- Lose Claude Max subscription value — Anthropic models would route through OpenRouter at per-token pricing
- Lose Anthropic-native features that don't pass through OpenRouter cleanly (extended thinking blocks, fine prompt cache control, citations API)
- Lose the `/usage` introspection we wired up for Anthropic + OpenAI subscription plans
- Lose Codex CLI native session resume / rollover features
- Single point of failure: if OpenCode breaks or `anomalyco/opencode` repo goes inactive, we have no fallback
- Cost model uncertain — needs side-by-side comparison vs current Claude Max + Codex subscription

**Decision gate:** measure real usage for 2-4 weeks after Mode A cutover (current). Audit which Anthropic/OpenAI-native features we actually depend on in production. Then cost-model both architectures. If feature loss is acceptable AND cost works out, lock Mode B universal as a v2 phase. Otherwise keep Mode B scoped to OpenCode lanes only and accept the asymmetry.

**Owner:** revisit during v2 phase planning. Reference: `~/.claude/workspace/projects/opencode-migration/PLAN.md` § Phase H.

---

## v3 Candidate — Subscription-Session Router (added 2026-05-15)

**Idea from Jamiah:** later NativeClaw could route Telegram turns into existing subscription-backed TUI/session runners instead of relying on `claude -p` / Agent SDK-style programmatic calls. In rough terms: keep Telegram as the control surface, but have the bridge manage Claude, Codex, and OpenRouter-style sessions as live session runners, preserving subscription value where possible and avoiding unnecessary programmatic billing.

**Why it matters:** Anthropic's June 15, 2026 Agent SDK credit change makes `claude -p`/SDK usage a separate credit bucket. If a future bridge can safely drive native interactive/session modes, NativeClaw may keep more work inside normal subscription lanes instead of paying per-token or burning limited Agent SDK credits.

**Key constraint:** do not make the model itself manually manage unmanaged terminal sessions. The bridge must own lifecycle, session IDs, routing, locks, status, recovery, and Telegram delivery. The agent should make routing decisions, not babysit fragile PTYs.

**Open research questions:**
- Can Claude's interactive CLI/TUI be driven safely enough for production, or is `claude -p` the only reliable noninteractive surface?
- Can Codex CLI be kept in a stable long-lived session with clean JSON/event extraction?
- Does OpenRouter/OpenCode remain better as an explicit programmatic lane rather than a subscription-preservation lane?
- What are the ToS / stability / failure-mode risks of TUI automation vs official programmatic APIs?

**Decision gate:** revisit after v2.1 subagent delegation ships and after real June 15 Agent SDK billing behavior is observed. This is probably v3 architecture, not v2.1.

---

## v3 Candidate — Telegram Bot-to-Bot Messaging (added 2026-05-18)

**Source:** Pavel Durov announcement 2026-05-18 (`https://x.com/durov/status/2056386732598432093`, 195k views): "AI devs asked for this — and we delivered. Bots can now talk to other bots on Telegram. Autonomous agents now have a communication layer humans can follow."

**Why it matters for NativeClaw:** today's subagent delegation (v2.1 `/bg`) is a file-drop + bridge-poll pattern hidden from the user. If subagents can be addressable Telegram bots, delegation becomes visible in-thread — Whet calls a specialized bot (image gen, OCR, research, voice), the conversation is auditable, and the human sees the work without extra UI. Potential architecture: per-capability bots (e.g. `@whet_image_bot`, `@whet_ocr_bot`) that Whet messages directly; replies route back into the active thread.

**Open research questions:**
- What exactly does the Bot API surface look like? Tweet announces but didn't link docs — need to read the Telegram Bot API changelog / @BotFather notes.
- Is bot-to-bot rate-limited differently from bot-to-human?
- Does message routing back to the originating user thread require explicit thread/topic IDs, or does Telegram model bots as full participants in groups/threads?
- How does this compose with our existing per-chat session/backend state machine?

**Decision gate:** after v2.1 subagent delegation ships and we have real usage data on `/bg`. If delegation feels invisible/awkward in v2.1, bot-to-bot could be the v3 surface for it.

---

## v2.1 Locked Spec — Subagent Delegation (added 2026-05-07)

Decided 2026-05-07 with Whet. Originally listed under § F as "Locked for v2.0" but pulled to v2.1 because the orphan module (`lib/subagent-delegation.ts`) wasn't actually wired and needed a real spec before implementation.

### Trigger
Slash command: `/bg <prompt>`. No heuristic inference — explicit only. Optional flags: `--max <minutes>`, `--cost <dollars>`.

### Backend
Uses the user's **active backend at spawn time**. `/bg` from a Kimi context spawns a Kimi subagent, from Claude → Claude, etc. No backend override flag in v2.1 (revisit if asymmetric needs emerge).

### Result delivery
**Bridge polls + auto-delivers.** Bridge scans `~/.claude/.subagents/done/` every 60s. On new completion, sends to originating Telegram chat as `🤖 Subagent <id> done (Xs, $Y):\n\n<text>`. No user-poll required.

### Failure delivery
Telegram message regardless of outcome. Status enum: `completed | failed | timeout | budget | killed`. Failed/timeout messages prefix `❌` and include error + last 200 chars of subagent output.

### Context
Full primer (SOUL + USER + MEMORY + last 3 daily logs + TOOLS), same as a fresh `/reset` turn. No gap-transcript injection — subagent is its own thing, not a backend handoff.

### Continuity
Standalone. Subagent runs in its own session. Result drops to Telegram as a free-standing message, not threaded into the originating Claude/Codex/OpenRouter profile session history.

### Caps
- Wall-clock: 10 min default (override `/bg --max 30`, hard ceiling 60 min)
- Cost: $2/run hard ceiling on Codex/OpenCode (live token billing visible). Claude only post-hoc reports cost — soft check, log warning if exceeded
- Concurrent: 3 in-flight per chat; 4th queued
- On cap hit: kill, deliver partial result if any, status = `timeout` or `budget`
- **Cost reality check:** skipped for v2.1 (no Claude Max weekly-utilization gating). Revisit if subscription burn becomes a problem.

### MEMORY evaluation flow
Subagents do NOT write to daily logs. Instead:
1. On completion, bridge runs cheap regex heuristic on result text (entity detection: client names, $/€ amounts, dates, "found/discovered/learned" keywords).
2. If heuristic hits, marker file `~/.claude/.subagents/pending-review/<id>` written.
3. Bridge prepends to **next user-message primer** for the originating chat: `📋 Subagent <id> just completed. Preview: <300 chars>. Evaluate if anything belongs in MEMORY.md.`
4. Main agent (Whet) decides → writes if durable → removes marker.

This means user sees raw result in real time, agent sees it on next turn with explicit "evaluate this" framing. Two-pass design, no race condition with live writes.

### Bridge restart resilience
On startup, bridge rediscovers `~/.claude/.subagents/inflight/*.json`:
- For each, check if PID still alive via `process.kill(pid, 0)`
- If alive: re-attach polling
- If dead: check for `done/<id>.json`; if missing, mark status `orphaned`, write minimal result, deliver to Telegram

### Self-spawn (agent-initiated)
Whet (and any other agent on the install) can fire subagents via shared CLI: `bash ~/.claude/scripts/subagent fire --prompt "..." --backend <auto|claude|codex|openrouter> [--profile <name>] [--max] [--cost]`. Returns `{id, status: "queued"}` immediately. Same code path as `/bg`.

**Default agent pattern: fire-and-forget.** Agent calls `subagent fire` and returns. Telegram gets the result async via the standard delivery path. Agent does NOT poll its own subagent results unless explicitly synthesizing.

### File layout
```
~/.claude/.subagents/
  queue/<id>.json       # written by /bg or `subagent fire`; bridge picks up every 5s
  inflight/<id>.json    # bridge moved here after detached spawn (pid + start time)
  done/<id>.json        # final result (text, status, cost, duration)
  pending-review/<id>   # marker for memory-eval primer injection
```

### CLI
```
~/.claude/scripts/subagent
  fire --prompt "..." --backend <auto|claude|codex|openrouter> [--profile <name>] [--max 600] [--cost 2]
  poll <id>
  list
  kill <id>
```

### Slash commands (Telegram)
- `/bg <prompt>` — fire subagent on active backend
- `/agents` — list in-flight + last 5 completed (id, age, status, $)
- `/agents kill <id>` — manual abort
- `/agents view <id>` — re-send completed result

### Out of scope for v2.1
- Subagent-to-subagent delegation (recursion)
- Cross-chat subagents (only delivers to originating chat)
- Persistent named subagents (`/agents resume X`)
- Voice trigger (text only)

### Build estimate
~7-8 hours real work. Existing `lib/subagent-delegation.ts` is partially reusable (detached-spawn pattern is correct); throw out the OpenCode-only assumption and the dead `idleTimer` no-op.
