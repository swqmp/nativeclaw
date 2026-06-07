# NativeClaw

NativeClaw is a personal AI agent that runs as a managed background service on macOS, Linux, or Windows and talks to you through Telegram.

It started as a Claude Code bridge. Current NativeClaw can run Claude, Codex (OpenAI CLI), or any configured OpenRouter profile as the active backend, keep persistent workspace memory, run scheduled jobs, handle common media inputs, and survive service restarts.

> [!WARNING]
> **Deprecated as of 2026-06-15.** The Telegram bridge is being sunset. Starting June 15, 2026, Claude Agent SDK / `claude -p` usage (which the Claude backend depends on) moves off plan limits onto separate metered credits, changing the cost model this project was built around. **`v2.1.0` is the final feature release.** Existing installs keep running and the Codex / OpenRouter backends are unaffected, but no further bridge development is planned.

## What It Does

- Responds to Telegram messages through Claude Code, Codex CLI, or OpenCode for OpenRouter profiles
- Switches backends with `/claude`, `/codex`, `/or profile <name>`, plus convenience aliases such as `/kimi`, `/minimax`, and `/grok`
- Preserves backend-switch continuity with raw gap transcripts
- Auto-compacts long sessions by backend/profile threshold; `/compact` triggers manual compaction
- Shows live context-window usage per backend with `/stats`
- Runs bridge-level scheduled jobs such as briefs, audits, queue recovery, and heartbeats
- Keeps durable memory in workspace files instead of relying on chat history
- Supports images, voice notes, audio files, and document attachments
- Uses launchd, systemd, or Windows Task Scheduler so the bridge survives reboot/crash cycles
- Ships a visual setup wizard and an on-demand control panel at `127.0.0.1:9292` (no terminal required after install)

## What's Current

Current bridge version: `v2.1.0` (final feature release — see deprecation notice above).

**v2.0 is a major release** — NativeClaw becomes an installable assistant with a visual setup flow and a persistent control panel. See [v2/README.md](v2/README.md) and [v2/CHANGELOG.md](v2/CHANGELOG.md) for v2.0-specific docs.

v2.0 highlights:
- **Setup Wizard** at `127.0.0.1:9292` — browser-based 6-step flow with retry/skip/edit recovery, plus terminal TUI mode (`nativeclaw setup`)
- **Settings UI** — on-demand control panel at `127.0.0.1:9292` with 7 tabs (Status / Config / MCP / Cron / Connections / Logs / Backup), random-token URL auth, 30-min idle auto-shutdown
- **Cross-platform parity** — macOS (launchd), Linux (systemd), Windows (Task Scheduler + DPAPI). `install.sh` and `install.ps1` produce identical installs.
- **Backup / Restore / Doctor** — `nativeclaw backup`, `nativeclaw restore <zip>`, `nativeclaw doctor` for diagnostic bundles
- **xAI Grok STT** voice transcription (fast + cheap; OpenAI Whisper as fallback)
- **OpenRouter profiles** — Kimi, MiniMax, Grok, or any OpenRouter model ID through one configurable lane
- **`/compact` slash command** — manual compaction across all four backends
- **`/stats` context window display** — separates context window from current context usage

Carried over from v1.10:
- **Agent reliability stack**: QMD semantic memory search, feedback-loop discipline, platform keychain for API keys, MCP probe + wrapper, task queue, session self-audit, memory-reminder hooks
- `/codex` and `/claude` backend switching with timestamped gap transcripts
- `/codex --full` and `/claude --full` force full available gap replay
- `/effort <low|medium|high|xhigh|max>` for Claude/Codex reasoning depth
- `/verbosity <default|low|medium|high>` for Codex response verbosity
- `/opus` maps to Opus 4.7, with `/opus4.6` kept as a legacy alias
- Session-audit cron clears both Claude and Codex sessions
- Slash-command eval harness: `node ~/.claude/telegram-bridge/eval-slash-commands.js`

See **[v2/CHANGELOG.md](v2/CHANGELOG.md)** for v2.0 changes and **[CHANGELOG.md](CHANGELOG.md)** for v1.x history. **[UPGRADING.md](UPGRADING.md)** has migration notes from v1.9.x.

## Requirements

- macOS, Linux, or Windows
- Node.js 18+
- Telegram account and bot token from [@BotFather](https://t.me/BotFather)
- At least one backend installed:
  - Claude Code CLI (`claude`) with an active Claude subscription, **or**
  - Codex CLI (`codex`) with an active ChatGPT/OpenAI account, **or**
  - OpenCode CLI (`opencode`) for OpenRouter profiles
  - Any combination is supported.
- **xAI API key** for voice transcription via Grok STT (OpenAI Whisper supported as fallback)
- **OpenRouter API key** if using OpenRouter profiles

> **Note on OpenRouter:** Kimi, MiniMax, Grok, and future models are profiles. Stable native fallbacks remain `/claude` and `/codex`.

Before running PowerShell scripts on Windows, open PowerShell as Administrator and run:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Quick Start

**One-line install (macOS / Linux):**

```bash
bash <(curl -fsSL https://install.nativeclaw.dev)
```

**One-line install (Windows PowerShell, as Administrator):**

```powershell
iwr -useb https://install.nativeclaw.dev/install.ps1 | iex
```

**Or clone and run locally:**

```bash
git clone https://github.com/swqmp/nativeclaw.git
cd nativeclaw
bash v2/install/install.sh
```

After install, run the setup wizard:

```bash
nativeclaw setup
```

The wizard runs as a browser flow at `127.0.0.1:9292` (or terminal TUI mode if you prefer). Six steps with retry/skip/edit recovery on each:

1. **Welcome** — quick orientation
2. **Prereq** — checks Node.js and available backend CLIs (Claude / Codex / OpenCode); installs missing pieces with SSE-streamed progress
3. **Backend** — choose Claude, Codex, OpenRouter profiles, or a combination
4. **Identity** — what your agent should be called, what it should call you
5. **Telegram** — paste your bot token from @BotFather
6. **Features** — optional: xAI voice key, OpenRouter API key, Nano Banana image gen, QMD semantic memory, prompt hooks
7. **Install** — wires bridge, scripts, workspace templates, skills, hooks, cron schedule, and the platform service manager
8. **Done** — service starts; first Telegram message activates the agent

## What You Get Out of the Box

Beyond the core bridge, v2.0 ships an **agent reliability stack** so your agent behaves well from day one:

**Memory that learns**
- `feedback/` — per-task correction logs the agent reads before repeatable output
- Checkpoint discipline baked into `AGENTS.md` (mandatory fields, promotion rules)
- `memory/` daily logs + system file promotion
- Optional QMD (`search_memory` MCP) — semantic search across all of the above via Gemini Embedding 2

**Reliability**
- `system/mcp-health/mcp-wrapper.js` — init-replay supervisor with circuit breaker for flaky MCPs; fetches secrets from OS keychain
- `system/mcp-health/probe.js` — every-15-min pre-flight check, writes `last-probe.json`, surfaces stale/failing MCPs
- `system/scripts/mcp-status.sh` — critical-vs-optional triage before escalating
- `system/scripts/keychain-add.sh` (macOS) / `keychain-add-linux.sh` (libsecret) — store API keys outside `.mcp.json`
- `system/scripts/scan-secrets.sh` — daily sweep for accidentally-committed secrets

**Context preservation**
- `system/task-queue/queue.json` — survives rate-limits and crashes via `task-queue-recovery` cron
- `system/scripts/session-self-audit.js` — scans transcripts every 4 hours for unkept commitments and stale checkpoints
- `hooks/memory-check.sh` + `hooks/feedback-check.sh` — UserPromptSubmit hooks that inject reminders when the agent should search memory or log a correction

**Quality of life**
- `system/scripts/video-extract.sh` — YouTube/Instagram/TikTok caption + Whisper transcription
- `system/PLATFORM_FORMATTING.md` — Discord/WhatsApp/group-chat formatting rules
- `skills/` — bundled skills (design, document handling, testing, brainstorming) plus `SKILL_INDEX.md`

All optional pieces (QMD, hooks, image gen) can be skipped during setup and enabled later through `nativeclaw settings`. See [OPERATIONS.md](OPERATIONS.md).

## First-Run Experience

NativeClaw is designed so setup is the only terminal-heavy part. After the bridge starts, the normal user experience is Telegram-first:

1. Message your bot in Telegram.
2. On the first non-command message, NativeClaw sends a short welcome that explains what to say next.
3. Run `/status` to confirm the bridge is alive.
4. Tell the agent who you are and what you want help with.
5. Let the agent write durable context into `USER.md`, `MEMORY.md`, and `TOOLS.md`.
6. Use `/claude`, `/codex`, `/or profile <name>`, `/kimi`, `/minimax`, or `/grok` to switch between installed backends/profiles.

Set `"firstRunOnboarding": false` in `config.json` if you want to skip the Telegram welcome.

Plain-English concepts:
- **Telegram bot:** the private chat surface where you talk to your agent.
- **Bot token:** the secret Telegram gives NativeClaw so it can receive and send bot messages.
- **Backend:** the model CLI that answers messages. Claude and Codex are native lanes. OpenRouter profiles run through OpenCode and share an `OPENROUTER_API_KEY`.
- **MCP:** a tool connector. MCP servers let the agent talk to apps and data sources such as calendars, files, GitHub, or custom APIs. Edit them through the Settings UI MCP tab or by hand in `.mcp.json`.
- **QMD:** optional semantic memory search. It embeds memory files with Google's Gemini embedding API so the agent can search past decisions by meaning, not just exact keywords.

## Architecture

```text
User (Telegram) -> Bridge (Node.js) -> Active Backend -> Response -> Telegram
                          ├─ Claude Code CLI
                          ├─ Codex CLI
                          └─ OpenCode (OpenRouter profile)
                          ↓
                Bridge Cron Scheduler -> active backend or command-only cron
                          ↓
                Setup Wizard / Settings UI (127.0.0.1:9292, on-demand)
```

Important files after install:

```text
~/.nativeclaw/
└── bin/nativeclaw         (CLI: setup / settings / backup / restore / doctor / status)

~/.claude/
├── telegram-bridge/
│   ├── bridge.js
│   ├── eval-slash-commands.js
│   ├── config.json
│   └── state.json
├── workspace/
│   ├── CLAUDE.md
│   ├── NATIVECLAW.md
│   ├── SOUL.md
│   ├── AGENTS.md
│   ├── MEMORY.md
│   ├── USER.md
│   ├── TOOLS.md
│   ├── HEARTBEAT.md
│   ├── .mcp.json
│   ├── memory/
│   ├── feedback/
│   ├── cron/
│   └── cron-workspace/
├── scripts/
├── cron-schedule.json
└── logs/
```

## Telegram Commands

| Command | What It Does |
|---|---|
| `/claude` | Use Claude backend |
| `/claude --full` | Use Claude and force raw gap transcript injection from previous backend |
| `/codex` | Use Codex backend |
| `/codex --full` | Use Codex and force raw gap transcript injection from previous backend |
| `/codex help` | List Codex model shortcuts |
| `/or list` | List OpenRouter profiles |
| `/or profile <name>` | Use an OpenRouter profile |
| `/or set <name> <provider/model>` | Save a custom OpenRouter profile |
| `/or providers <name> --order A,B --fallbacks on\|off` | Configure OpenRouter provider routing |
| `/kimi`, `/minimax`, `/grok` | Convenience aliases for OpenRouter profiles |
| `/catchup` | Pull recent context from the OTHER backend without switching backends |
| `/5.5`, `/5.4`, `/5.4-mini`, `/5.3-codex`, `/5.2`, `/5.2-codex`, `/5.1-codex-max`, `/5.1-codex-mini` | Set Codex model |
| `/opus` | Switch Claude model to Opus 4.7 |
| `/opus4.6` | Switch Claude model to Opus 4.6 |
| `/sonnet` | Switch Claude model to Sonnet 4.6 |
| `/haiku` | Switch Claude model to Haiku 4.5 |
| `/effort <low|medium|high|xhigh|max>` | Set Claude/Codex reasoning effort |
| `/think` | Compatibility toggle for max effort |
| `/verbosity <default|low|medium|high>` | Set Codex verbosity |
| `/compact` | Manually compact the active backend's context window |
| `/stop` | Abort the running task and clear queue |
| `/reset` | Clear current backend session/thread |
| `/fresh` | Alias for `/reset` |
| `/stats` | Last response stats + per-backend context window (e.g. `Context: 1M (134k filled)`) |
| `/usage` | Plan usage: 5-hour + 7-day windows for Claude and Codex (Codex line requires `codex login` first) |
| `/session` | Show session/thread info |
| `/status` | Show backend/model/session state |
| `/restart` | Ask the service manager to restart the bridge |
| `/help` | Show commands |

## NativeClaw CLI

After install, the `nativeclaw` command exposes the management surface:

| Command | What It Does |
|---|---|
| `nativeclaw setup` | First-time setup wizard (browser at `127.0.0.1:9292` or terminal TUI) |
| `nativeclaw settings` | Open the on-demand control panel at `127.0.0.1:9292` (auto-shutdown after 30 min idle) |
| `nativeclaw status` | Bridge health snapshot (PID, backend, last activity) |
| `nativeclaw backup` | Archive workspace to a zip (excludes secrets by default; `--include-secrets` opts in) |
| `nativeclaw restore <zip>` | Restore from a backup on a fresh machine |
| `nativeclaw doctor` | Bundle logs, sanitized state, MCP health, and system info into a diagnostic zip |

## Service Commands

macOS:

```bash
launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist
launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist
launchctl kickstart -k gui/$(id -u)/com.nativeclaw.session
tail -f ~/.claude/logs/telegram-bridge.log
```

Linux:

```bash
systemctl --user start nativeclaw
systemctl --user stop nativeclaw
systemctl --user restart nativeclaw
journalctl --user -u nativeclaw -f
```

Windows:

```cmd
schtasks /run /tn "NativeClaw"
schtasks /end /tn "NativeClaw"
schtasks /delete /tn "NativeClaw" /f
```

Cross-platform shortcut: `nativeclaw status` works on all three OSes.

## Backend Setup Notes

**Codex:** The bridge can launch Codex without extra repo files if `codex` is on PATH. For MCP access, mirror your MCP servers into `~/.codex/config.toml`. NativeClaw's Codex preamble expects that config path.

Smoke test:

```bash
codex exec "Say OK" -c model_reasoning_effort='"xhigh"' -c model_verbosity='"low"'
```

**OpenRouter profiles:** Kimi, MiniMax, Grok, and any custom OpenRouter model ID run through OpenCode (`opencode` CLI on PATH). The bridge reads `OPENROUTER_API_KEY` from your OS keychain. MCP servers configured in `.mcp.json` are loaded automatically by OpenCode at runtime; you can edit profiles and provider routing from slash commands or Settings UI.

**Bridge eval harness** (validates all slash commands across all backends):

```bash
node ~/.claude/telegram-bridge/eval-slash-commands.js
```

## Supported Media

| Type | How It Works |
|---|---|
| Text | Sent directly to the active backend |
| Images | Downloaded and passed for visual analysis |
| Voice messages | Transcribed with xAI Grok STT (OpenAI Whisper supported as fallback), then sent as text |
| Audio files | Same as voice messages |
| Files | Downloaded and passed with the prompt/caption |

## Customization

NativeClaw is meant to be heavily personalized:

- `SOUL.md` defines agent identity and voice
- `AGENTS.md` defines hard rules and workflows
- `MEMORY.md` stores durable context
- `USER.md` stores durable user facts
- `TOOLS.md` documents available tools and local setup
- `cron-schedule.json` defines scheduled jobs (also editable from Settings UI Cron tab)
- `.mcp.json` defines MCP servers (also editable from Settings UI MCP tab)

See [OPERATIONS.md](OPERATIONS.md) for maintenance details.

## License

MIT © Jamiah Bartlett
