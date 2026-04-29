# NativeClaw Changelog


## v1.10.2 — Cold-boot resilience: bridge auto-restart fix

Fixes a stacked failure mode where the Telegram bridge would silently fail to come up after a Mac wake/boot if Wi-Fi wasn't yet ready when launchd fired the agent.

### Problem
1. `bridge.js` validated the bot token by calling Telegram's `getMe` exactly once. If that fetch failed (e.g. network not yet up), it logged `FATAL: Invalid bot token: fetch failed` and exited. The error message was misleading — the token was fine; the network wasn't.
2. `claude-restart.sh` only watched the bridge process when a PID file existed. When the bridge died before writing the PID file, the wrapper fell into an indefinite `sleep`/`wait` loop, hiding the failure from launchd. Result: the agent looked alive to the OS, but the bridge was actually dead.

### Fix
- **`bridge.js`:** `getMe` now retries with backoff (2s · 5s · 10s · 15s · 30s · 30s ≈ 92s total). Auth-shaped errors (401/403/Unauthorized/Forbidden) still bail immediately; only transient `fetch failed` / network errors trigger retries.
- **`scripts/claude-restart.sh`:** rewritten as a supervisor loop. The same path handles healthy-bridge-died (quick respawn, no failure counter bump) and bridge-failed-to-start (linear backoff up to 60s). After 5 consecutive failed starts, the wrapper exits non-zero so launchd's `KeepAlive` performs a full agent restart.

### How to apply on existing installs
Pull the new `scripts/claude-restart.sh` and `bridge/bridge.js`, then restart the bridge:

```
launchctl kickstart -k gui/$(id -u)/com.nativeclaw.session   # macOS
systemctl --user restart nativeclaw.service                  # Linux
```

No plist or service file changes required.

## v1.10.1 — `/usage` slash command

- **`/usage` Telegram command:** Returns current plan utilization for both backends in one fast view. Hits the same internal endpoints the official CLIs use under the hood:
  - Claude: `GET https://api.anthropic.com/api/oauth/usage` with the OAuth token from the OS keychain (`Claude Code-credentials` on macOS) plus `anthropic-beta: oauth-2025-04-20`. Returns `five_hour.utilization`, `seven_day.utilization`, `seven_day_opus`, `seven_day_sonnet`, each with `resets_at`.
  - Codex: `GET https://chatgpt.com/backend-api/wham/usage` with the access token from `~/.codex/auth.json` plus `ChatGPT-Account-ID` header. Returns `rate_limit.primary_window` (5h) + `secondary_window` (7d), each with `used_percent`, `reset_at`, plus `plan_type` and `credits.has_credits`.
- **Fuel-gauge bar UI:** Bars display `% left` — full bar = plenty of quota, draining bar = burning through. Both APIs return `% used` semantically; bridge inverts to `% left` for visual consistency with Codex CLI's native `/status` rendering.
- **Parallel fetch:** Both backends queried via `Promise.all`; one slow backend doesn't block the other. Per-backend errors render as `⚠️ <reason>` line without crashing the reply.
- **Risk:** Both endpoints are undocumented internal APIs. If Anthropic or OpenAI changes them, `/usage` will degrade gracefully (per-backend error line). Worth re-verifying on each major CLI version bump.


## v1.10.0 — Agent Reliability Stack

First major release focused on making the agent reliable out-of-box, not just functional. Every piece here came from real-world patterns that caught hallucinations, context loss, or credential leaks.

### Bridge — Session & Backend Architecture
- **5 AM ET session-day anchor:** `getCurrentSessionDay()` treats hours 00:00–04:59 ET as the previous calendar day so live sessions survive the midnight boundary. The 5:10 AM `session-audit` cron is now safety-net only, not the primary kill.
- **Gap transcript backend switching:** `/codex` and `/claude` resume the target backend's same-day session/thread and inject the other backend's most recent user/assistant text gap with timestamp framing. No LLM summary call is made on switch. Gap blocks cap at 50k characters and drop oldest entries first. Old breadcrumb pointer and LLM handoff-summary paths removed.
- **Collapsed Codex `CONTEXT_PROFILES`:** `chat` and `work` profiles merged into a single `chat` profile that injects SOUL + USER + TOOLS + NATIVECLAW + device + MEMORY + last 3 daily logs, matching Claude's primer for parity. `cron` profile remains lean. `detectContextProfile()` removed.
- **`SESSION_START_COMPLETED_TODAY` flag:** New global flag in `state.json` so the SESSION START checklist runs once per 5 AM session day instead of on every fresh session/thread switch. Both Claude and Codex primers honor it.
- **Per-day Claude/Codex session tracking:** `state.sessionDates` and `state.codexSessionDates` bind sessions/threads to the day they were created. Switching `/claude` ↔ `/codex` resumes the target backend's same-day session/thread instead of force-cold-starting it. True cold start happens at daily session audit, on `/reset`, or on `clearStoredSession()`.
- **Codex execution serialization:** Codex user turns and Codex crons no longer launch in parallel. User priority — fixes the empty-response bug seen during overlapping heartbeat/task-queue runs.
- **Codex rollover relaxed:** Thresholds bumped to 1.5 MB / 250 entries, missing rollout files no longer force fresh threads. Daily reset remains the main bound; rollover is a true safety valve.
- **Codex CLI emit handling:** Bridge filters `codex exec --json` replies to the last `agent_message` only — Codex emits commentary and final answers as the same event type with no phase marker, which was bundling startup chatter into Telegram replies.

### Bridge — File Attachments
- **Image extension fallback:** HEIC, HEIF, WebP, BMP, TIFF, SVG now accepted via filename extension when the document MIME is missing or generic (Telegram strips MIME for some iPhone uploads).
- **Expanded document allowlist:** RTF, ODT/ODS/ODP (OpenDocument), EPUB, YAML/TOML, EML/MSG (email), TEX (LaTeX), IPYNB (Jupyter), `.log` files, and PPT (legacy Office) added to MIME and extension fallbacks. Existing PDF/DOCX/XLSX/PPTX/TXT/CSV/MD/JSON/XML/HTML preserved.
- **Updated user-facing error message** lists the new coverage when an unsupported type is sent.

### New — Memory That Learns
- **QMD semantic memory search (opt-in):** `workspace/system/mcp/qmd/server.js` — Gemini Embedding 2 over daily logs, MEMORY.md, and feedback files. Disabled by default; enable during `setup.sh` or by renaming `__qmd_disabled` to `qmd` in `.mcp.json`.
- **Feedback loop starter:** `workspace/feedback/{general,emails,reports}.md` — the agent reads the matching file before producing repeatable output. Checkpoint discipline enforced in the new AGENTS.md (mandatory fields, promotion table).
- **Memory snapshots:** `workspace/system/scripts/snapshot-memory.sh` keeps the last 30 MEMORY.md versions. Wired as `snapshot-memory` cron at 5:05 AM.

### New — Reliability
- **MCP wrapper supervisor:** `workspace/system/mcp-health/mcp-wrapper.js` — init replay, circuit breaker, auto-respawn. Fetches secrets from the platform keychain (macOS `security`, Linux `secret-tool`).
- **MCP pre-flight probe:** `workspace/system/mcp-health/probe.js` — 15-minute health check (cron: `mcp-probe`). Writes `last-probe.json` consumed by session-start checklists.
- **MCP triage:** `workspace/system/scripts/mcp-status.sh` — classifies outages via `mcp-criticality.json` before escalating.
- **Keychain tooling:** `keychain-add.sh` (macOS) / `keychain-add-linux.sh` (libsecret). API keys leave `.mcp.json` and move to the OS keychain.
- **Secrets scanner:** `workspace/system/scripts/scan-secrets.sh` — daily sweep for accidentally-committed keys (cron: `secrets-scan` at 7:15 AM).

### New — Context Preservation
- **Task queue:** `workspace/system/task-queue/queue.json` survives rate-limits and crashes. Recovered hourly by `task-queue-recovery` cron.
- **Session self-audit:** `workspace/system/scripts/session-self-audit.js` runs 10am/2pm/6pm/10pm. Scans recent transcript for unkept commitments, unlogged corrections, stale checkpoints.
- **Prompt hooks:** `hooks/memory-check.sh` + `hooks/feedback-check.sh` — UserPromptSubmit hooks that inject "search memory first" or "log this correction" reminders based on user phrasing.

### New — Quality of Life
- **Video extraction:** `workspace/system/scripts/video-extract.sh` — YouTube/Instagram/TikTok caption + Whisper transcription via yt-dlp. Paths parameterized via `$NATIVECLAW_WORKSPACE`.
- **Platform formatting rules:** `workspace/system/PLATFORM_FORMATTING.md` — Discord/WhatsApp/group-chat guidance.
- **Bundled skills:** 14 total — adds frontend-design, web-design-guidelines, webapp-testing, docx/pdf/xlsx/pptx, brainstorming, ab-test-setup, canvas-design, algorithmic-art. See new `workspace/skills/SKILL_INDEX.md`.

### AGENTS.md — Full Rewrite
- Non-negotiables section covers honesty, execution, git safety, memory discipline, feedback loop.
- SESSION START 5-step checklist (backup / daily logs / task queue / MCP health / greet).
- AFTER COMPACTION protocol.
- Checkpoint format with 6 mandatory fields (What we did / Decisions / Open questions / Next actions / Feedback logged / MEMORY.md delta).
- System file promotion table.

### Setup Wizard
- New backend setup flow: asks for agent name and user name, then supports Claude-only, Codex-only, or Claude + Codex installs.
- New steps: optional QMD enable (stores Gemini key in OS keychain), optional hook install into `~/.claude/settings.json`.
- Installs all 14 bundled skills instead of just 3.
- Copies reliability scripts, MCP health files, task queue, and platform formatting docs.

### Cron Schedule
- Added `mcp-probe` (*/15 min, command-only), `secrets-scan` (7:15 AM, command-only), `snapshot-memory` (5:05 AM, command-only), `session-self-audit` (10am/2pm/6pm/10pm, command-only). None burn an LLM turn.

### Parameterization
- All paths use `$NATIVECLAW_WORKSPACE` (falls back to `$HOME/.claude/workspace`).
- Keychain account via `$NATIVECLAW_KEYCHAIN_ACCOUNT` (falls back to `$USER`).
- Claude Code project dir derivable from workspace via `$NATIVECLAW_PROJECT_DIR`.

---

## v1.9.4 — Claude/Codex Backend Bridge

### Bridge (bridge.js)
- **Codex backend support:** `/codex` switches from Claude to Codex, `/claude` switches back. Backend switches resume same-day target sessions/threads when available and carry continuity through curated handoff summaries.
- **Symmetric handoffs:** `/codex` and `/claude` precompute handoff summaries during the slash command. `/codex --full` and `/claude --full` keep raw transcript replay as escape hatches.
- **Sonnet handoff summaries:** Handoffs use Sonnet and include a deterministic latest-exchange block so short answers, IDs, tokens, command output, and test phrases survive backend switches.
- **Codex model shortcuts:** `/5.4`, `/5.4-mini`, `/5.3-codex`, `/5.2`, `/5.2-codex`, `/5.1-codex-max`, and `/5.1-codex-mini`.
- **Unified effort control:** `/effort <low|medium|high|xhigh|max>` maps to Claude `--effort`; Codex receives `model_reasoning_effort`, with Telegram `max` mapped to Codex `xhigh`.
- **Codex verbosity control:** `/verbosity <default|low|medium|high>` maps to Codex `model_verbosity`.
- **Opus 4.7 default alias:** `/opus` now maps to Opus 4.7. `/opus4.6` and `/opus-4.6` remain as legacy escape hatches.
- **Bridge-level crons:** Crons route to the active backend. Session audit clears both Claude and Codex sessions when it completes.
- **Response truncation fix:** The bridge reads Claude session JSONL to concatenate all assistant text blocks from the final turn, preventing dropped text after tool calls.

### Tooling
- Added `bridge/eval-slash-commands.js` to catch command-surface regressions without hitting external APIs.
- Setup now installs the eval harness and can store an optional OpenAI API key for voice transcription.

### Templates & Docs
- Updated runtime docs for Claude/Codex architecture, backend switching, effort/verbosity controls, Codex context profiles, and current Telegram commands.

## v1.6.1 — Session Rot Fix & Polish

### Bridge (bridge.js)
- **Telegram HTML formatting:** New `mdToHtml` converter — messages render with bold, italic, code blocks, and headers in Telegram instead of raw markdown
- **Session-audit auto-clear:** Bridge mechanically clears session IDs after `session-audit` cron completes. No longer relies on the LLM to execute a python3 command (which it was silently skipping)
- **Checkpoint modulo fix:** Reminder now fires at 8, 16, 24 exchanges — not every message after 8. Previous behavior caused infinite reminder spam that produced empty responses
- **File attachment crash fix:** `userName` undefined → `senderName` — sending files via Telegram no longer crashes the bridge
- **OpenAI Whisper API:** Voice transcription uses cloud API (`whisper-1`) instead of local Whisper binary. Faster, no local CPU load. Requires `openaiApiKey` in config.json

### Templates
- **AGENTS.md:** Added MEMORY.md staleness rule (update if 3+ days stale), feedback path clarification (`feedback/general.md` not `feedback_general.md`), write method rule (Edit/Write tools, not bash)
- **cron-schedule.example.json:** Added `session-audit` cron example (daily 5:10 AM)

---

## v1.6.0 — Performance & Reliability

### Bridge (bridge.js)
- **Lightweight cron context:** Cron jobs now run from `workspace/cron-workspace/` instead of the full workspace. Crons load ~80 lines of system prompt instead of your full agent context. Faster crons, less token waste, less identity confusion.
- **Checkpoint enforcement:** Bridge tracks exchange count per session. After 8 messages without a daily log update, injects a checkpoint reminder into the next prompt. Prevents memory loss during long sessions.
- **Exchange counter reset on /reset.**

### New Files
- `workspace/cron-workspace/CLAUDE.md` — Lightweight system prompt for cron jobs
- `workspace/cron/CONTEXT_LITE.md` — Condensed context template for crons/heartbeats
- `workspace/system/EVAL_FRAMEWORK.md` — Weekly self-evaluation template (5 metrics)
- `scripts/agent-browser.sh` — Persistent Chromium via CDP for browser tasks needing login persistence (macOS + Linux)

### Templates
- **AGENTS.md** — Improved template with session start checklist, compaction canary, file organization guidance (keep under 200 lines)
- **cron-schedule.example.json** — All example prompts now include identity prefix + weekly eval cron

### Documentation
- **OPERATIONS.md** — Added: hooks documentation (memory-check + feedback-detection), persistent browser setup, REFERENCE.md pattern

---

## v1.5.2 — Voice transcription fix
**Bug fixes:**
- Fixed voice transcription failing on first run — Whisper was downloading the multilingual `base` model (139MB) on each invocation when not cached, causing timeouts. Switched to `base.en` (English-only, 72MB) which is faster, smaller, and caches reliably.
- Fixed `userName` undefined in voice and audio log lines — logs now correctly show the sender's name.

## v1.5.1 — Message debounce fix
- Fixed rapid duplicate messages being sent when Telegram retried unacknowledged updates.

## v1.5 — Native Windows support
- Added Windows setup guide and launchd equivalent for Task Scheduler.
- Cross-platform PATH handling for Whisper and ffmpeg.

## v1.4 — Voice messages, audio files, and file attachments
- Voice messages transcribed locally with OpenAI Whisper, sent to Claude as text.
- Audio files (forwarded voice notes, audio attachments) handled the same way.
- File attachment support expanded: PDF, DOCX, XLSX, PPTX, TXT, CSV, JSON, Markdown, XML, HTML.
- Caption on file = prompt. No caption defaults to "Read and summarize."

## v1.3 — Keychain auth
- Switched to macOS Keychain for auth token storage. Dropped plaintext token file dependency.

## v1.2 — claude setup-token auth
- Auth now uses `claude setup-token` flow.

## v1.1 — Auth token detection fix
- Fixed setup wizard not detecting existing auth tokens on fresh installs.

## v1.0 — Initial release
- Telegram polling bridge with Claude Code subprocess.
- Message queue, cron scheduler, MCP config passthrough.
