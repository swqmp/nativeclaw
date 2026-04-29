# NativeClaw

NativeClaw is a personal AI agent that runs as a managed background service on macOS, Linux, or Windows and talks to you through Telegram.

It started as a Claude Code bridge. Current NativeClaw can run either Claude or Codex as the active backend, keep persistent workspace memory, run scheduled jobs, handle common media inputs, and survive service restarts.

## What It Does

- Responds to Telegram messages through Claude Code or Codex CLI
- Switches backends with `/claude` and `/codex`
- Preserves backend-switch continuity with raw gap transcripts
- Runs bridge-level scheduled jobs such as briefs, audits, queue recovery, and heartbeats
- Keeps durable memory in workspace files instead of relying on chat history
- Supports images, voice notes, audio files, and document attachments
- Uses launchd, systemd, or Windows Task Scheduler so the bridge survives reboot/crash cycles

## What's Current

Current bridge version: `v1.10.0`.

Highlights:
- **Agent reliability stack** (new in v1.10): QMD semantic memory search, feedback-loop discipline, platform keychain for API keys, MCP probe + wrapper, task queue, session self-audit, memory-reminder hooks
- `/codex` and `/claude` backend switching with timestamped gap transcripts
- `/codex --full` and `/claude --full` force full available gap replay
- `/effort <low|medium|high|xhigh|max>` for Claude/Codex reasoning depth
- `/verbosity <default|low|medium|high>` for Codex response verbosity
- `/opus` maps to Opus 4.7, with `/opus4.6` kept as a legacy alias
- Session-audit cron clears both Claude and Codex sessions
- Slash-command eval harness: `node ~/.claude/telegram-bridge/eval-slash-commands.js`

See **[CHANGELOG.md](CHANGELOG.md)** and **[UPGRADING.md](UPGRADING.md)** (if you're on v1.9.x).

See [CHANGELOG.md](CHANGELOG.md) for the detailed history.

## Requirements

- macOS, Linux, or Windows
- Node.js 18+
- Telegram account and bot token from [@BotFather](https://t.me/BotFather)
- Claude Code CLI (`claude`) with an active Claude subscription, Codex CLI (`codex`), or both
- OpenAI API key if you want voice/audio transcription through Whisper API

Windows users should run `setup.sh` in Git Bash or MSYS2, not Command Prompt or PowerShell.

Before running PowerShell scripts on Windows, open PowerShell as Administrator and run:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/nativeclaw.git
cd nativeclaw
bash setup.sh
```

The setup wizard will:
1. Check Node.js and available backend CLIs
2. Walk you through Telegram bot setup
3. Ask what your agent should be called and what it should call you
4. Let you choose Claude-only, Codex-only, or Claude + Codex
5. Install bridge, scripts, workspace templates, skills, hooks, and cron schedule
6. Store optional OpenAI API key for voice transcription
7. Offer optional Nano Banana image generation (Google Gemini)
8. Offer optional QMD semantic memory search (Google Gemini; key stored in your OS keychain)
9. Offer to wire memory-check + feedback-check prompt hooks into `~/.claude/settings.json`
10. Install and optionally start the service

## What You Get Out of the Box

Beyond the core bridge, v1.10 ships an **agent reliability stack** so your agent behaves well from day one:

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
- `skills/` — 14 bundled skills (design, document handling, testing, brainstorming) plus `SKILL_INDEX.md`

All optional pieces (QMD, hooks, image gen) can be skipped during setup and enabled later. See [OPERATIONS.md](OPERATIONS.md).

## First-Run Experience

NativeClaw is designed so setup is the only terminal-heavy part. After the bridge starts, the normal user experience is Telegram-first:

1. Message your bot in Telegram.
2. On the first non-command message, NativeClaw sends a short welcome that explains what to say next.
3. Run `/status` to confirm the bridge is alive.
4. Tell the agent who you are and what you want help with.
5. Let the agent write durable context into `USER.md`, `MEMORY.md`, and `TOOLS.md`.
6. Use `/claude` and `/codex` only if you installed both backends and want to switch models.

Set `"firstRunOnboarding": false` in `config.json` if you want to skip the Telegram welcome.

Plain-English concepts:
- **Telegram bot:** the private chat surface where you talk to your agent.
- **Bot token:** the secret Telegram gives NativeClaw so it can receive and send bot messages.
- **Backend:** the model CLI that answers messages. Claude and Codex are both supported; either can be the only backend.
- **MCP:** a tool connector. MCP servers let the agent talk to apps and data sources such as calendars, files, GitHub, or custom APIs.
- **QMD:** optional semantic memory search. It embeds memory files with Google's Gemini embedding API so the agent can search past decisions by meaning, not just exact keywords.

## Architecture

```text
User (Telegram) -> Bridge (Node.js) -> Active Backend -> Response -> Telegram
                                      ├─ Claude Code CLI
                                      └─ Codex CLI
                    ↓
             Bridge Cron Scheduler -> active backend or command-only cron
```

Important files after install:

```text
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
| `/claude --full` | Use Claude and force raw Codex gap transcript injection |
| `/codex` | Use Codex backend |
| `/codex --full` | Use Codex and force raw Claude gap transcript injection |
| `/codex help` | List Codex model shortcuts |
| `/5.4`, `/5.4-mini`, `/5.3-codex`, `/5.2`, `/5.2-codex`, `/5.1-codex-max`, `/5.1-codex-mini` | Set Codex model |
| `/opus` | Switch Claude model to Opus 4.7 |
| `/opus4.6` | Switch Claude model to Opus 4.6 |
| `/sonnet` | Switch Claude model to Sonnet 4.6 |
| `/haiku` | Switch Claude model to Haiku 4.5 |
| `/effort <low|medium|high|xhigh|max>` | Set Claude/Codex reasoning effort |
| `/think` | Compatibility toggle for max effort |
| `/verbosity <default|low|medium|high>` | Set Codex verbosity |
| `/stop` | Abort the running task and clear queue |
| `/reset` | Clear current backend session/thread |
| `/fresh` | Alias for `/reset` |
| `/stats` | Show last response stats |
| `/usage` | Plan usage: 5-hour + 7-day windows for Claude and Codex |
| `/session` | Show session/thread info |
| `/status` | Show backend/model/session state |
| `/restart` | Ask the service manager to restart the bridge |
| `/help` | Show commands |

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

## Codex Setup Notes

The bridge can launch Codex without extra repo files if `codex` is on PATH. For MCP access, mirror your MCP servers into `~/.codex/config.toml`. NativeClaw's Codex preamble expects that config path.

Recommended smoke test:

```bash
codex exec "Say OK" -c model_reasoning_effort='"xhigh"' -c model_verbosity='"low"'
```

Then run the bridge eval:

```bash
node ~/.claude/telegram-bridge/eval-slash-commands.js
```

## Supported Media

| Type | How It Works |
|---|---|
| Text | Sent directly to the active backend |
| Images | Downloaded and passed for visual analysis |
| Voice messages | Transcribed with OpenAI Whisper API, then sent as text |
| Audio files | Same as voice messages |
| Files | Downloaded and passed with the prompt/caption |

## Customization

NativeClaw is meant to be heavily personalized:

- `SOUL.md` defines agent identity and voice
- `AGENTS.md` defines hard rules and workflows
- `MEMORY.md` stores durable context
- `USER.md` stores durable user facts
- `TOOLS.md` documents available tools and local setup
- `cron-schedule.json` defines scheduled jobs
- `.mcp.json` defines Claude MCP servers

See [OPERATIONS.md](OPERATIONS.md) for maintenance details.

## License

Private. Do not distribute unless you know this repo is intentionally being shared.
