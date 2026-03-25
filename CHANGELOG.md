# NativeClaw Changelog

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
