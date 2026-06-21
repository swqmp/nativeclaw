# NativeClaw v2.0 Changelog

## 2.0.0 — May 2026

A major release. NativeClaw becomes an installable assistant with a visual setup flow and a persistent control panel. Power users keep `setup.sh` + raw JSON config. Non-developers get a browser-based install + control panel. Both paths produce the same install.

### Added

- **Setup Wizard** — Web-based browser flow at `127.0.0.1:9292` and terminal TUI mode (`nativeclaw setup`). Six steps (welcome / prereq / backend / identity / Telegram / features / install / done) with retry-skip-edit recovery on each step and SSE-streamed prereq install.
- **Settings UI** — On-demand control panel at `127.0.0.1:9292` (`nativeclaw settings`). Random-token URL auth, auto-shutdown after 30 min idle. Tabs: Status, Config, MCP servers, Cron schedule, Connections, Logs, Backup/Restore. All tabs are read + edit (saves persist to `~/.claude/telegram-bridge/config.json`, `~/.claude/workspace/.mcp.json`, `~/.claude/cron-schedule.json`).
- **Cross-platform support** — macOS (launchd), Linux (systemd), Windows (Task Scheduler + DPAPI keychain). PowerShell `install.ps1` and bash `install.sh` produce identical installs. Windows live validation is experimental in 2.0.0; please report issues.
- **Cross-platform keychain abstraction** — `lib/credentials.ts` handles macOS Security, Linux secret-tool, Windows Credential Manager via a single API.
- **Backup / Restore CLI** — `nativeclaw backup` zips workspace (excludes secrets by default; `--include-secrets` opts in). `nativeclaw restore` unpacks an archive on a fresh machine. Settings UI Backup tab triggers the same flow with one click.
- **Diagnostic Dump** — `nativeclaw doctor` bundles logs, sanitized state, MCP health, system info into a zip you can DM for support. Settings UI Logs tab has the same as a one-click export.
- **Voice transcription** — xAI Grok STT default (`api.x.ai/v1/stt`, `grok-stt` model). Wizard prompts for an xAI API key and links to console.x.ai for signup. Stored in OS keychain.
- **OpenRouter profiles** — Kimi, MiniMax, Grok, and custom OpenRouter model IDs now share one profile-based OpenCode lane. `/or list`, `/or profile`, `/or set`, and `/or providers` manage model IDs and provider routing.
- **Context compaction** — Bridge-owned compaction monitors Claude, Codex, and OpenRouter-profile thresholds. The stale exported `lib/compaction.ts` module was removed; the live bridge is the source of truth.
- **`/compact` slash command** — Manual compaction trigger across native and OpenRouter profile backends.
- **Cron routing fix** — OpenRouter profile crons route through `runOpenCode` instead of falling through to Claude.
- **/stats context window display** — `/stats` now separates `Context window` from `Current context`, and Codex uses `last_token_usage` instead of cumulative command totals.
- **Cross-platform keychain shim and Windows DPAPI bindings** for credential storage parity.

### Changed

- **CHANGELOG truth** — entries reflect what actually shipped. Earlier alpha bullets that referenced `Skills Auto-Extraction`, `Subagent Delegation`, Groq Whisper, and OpenCode plugin hooks have been removed (see Removed / Deferred sections below).
- **Settings UI architecture** — frontend tabs now pull live data from local config files instead of hardcoded stubs. Status tab does a real PID liveness check via `bridge.pid`.

### Removed

- **OpenCode plugin hooks** (originally Phase A) — pulled before adoption due to 30-60s plugin-loader cold start per turn. Replaced architecturally by bridge-side stat capture and agent-owned memory discipline (`AGENTS.md` checkpoint rules).
- **`lib/voice-handler.ts`** — orphan module with Groq/OpenAI/local fallback logic. Superseded by xAI Grok STT in production. Removed from source + dist.
- **`lib/skills-extractor.ts`** — orphan module that auto-generated "skill" markdown via bag-of-words pattern matching on assistant prose. Output was unusable; module never wired. Removed from source + dist.
- **`lib/compaction.ts`** — stale exported module with old Kimi/Grok assumptions. Removed from v2 exports; bridge inline compaction remains the maintained implementation.

### Deferred to v2.1

- **Subagent Delegation** — `/bg <prompt>` slash command with detached-process subagents, fire-and-forget delivery to Telegram, two-pass MEMORY evaluation. Full spec in `V2-PLAN.md` § "v2.1 Locked Spec — Subagent Delegation".
- **Background memory review** — automatic Haiku-driven memory extraction every N turns. Skipped because the AGENTS.md manual checkpoint discipline already covers this. Revisit with subagent infrastructure.
- **Bridge-side OpenCode tool-prefix injection** — `lib/bridge-checkpoint.ts` left in tree but unwired. May be revisited if OpenRouter profile output visibility becomes a problem.

### Migration from v1.10.x

- Existing installs upgrade via the v1.10.4 agent-driven flow ("check for updates"). Agent walks user through changelog, preserves `setup.sh`-based config, never touches user-content files (SOUL.md, MEMORY.md, etc.).
- VERSION file bumped 1.10.x → 2.0.0.
- Settings UI becomes available via `nativeclaw settings`. Power users who want nothing to change can ignore both wizard and settings UI and keep editing JSON.
- Google Workspace OAuth: v2.0.0 ships with **Option B** (user-owned OAuth client). Step-by-step doc included for non-developer setup.
