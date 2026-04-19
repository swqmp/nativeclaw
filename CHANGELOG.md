# NativeClaw Changelog

## v1.9.4 — Claude/Codex Backend Bridge

### Bridge (bridge.js)
- **Codex backend support:** `/codex` switches from Claude to Codex, `/claude` switches back. Backend switches clear stale target sessions and carry continuity through curated handoff summaries.
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
