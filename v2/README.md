# NativeClaw v2.0

⚡ **NativeClaw** — a personal AI agent that lives in your terminal and texts you back.

> Works with Claude, Codex, and configurable OpenRouter profiles. Runs 24/7 as a background service.

---

## Install (any OS)

```bash
# macOS / Linux — one command
curl -fsSL https://install.nativeclaw.dev | bash

# Windows — PowerShell
iwr -useb https://install.nativeclaw.dev/install.ps1 | iex
```

Then run the setup wizard:

```bash
nativeclaw setup
```

Follow the prompts. You will need:
- A Telegram bot token (from @BotFather)
- Claude CLI and/or Codex CLI installed
- Node.js 18+

---

## Quick Commands

| Command | What it does |
|---------|-------------|
| `nativeclaw setup` | First-time setup wizard (web or terminal) |
| `nativeclaw settings` | Open the settings UI control panel |
| `nativeclaw backup` | Archive your workspace to a zip |
| `nativeclaw restore <zip>` | Restore from a backup |
| `nativeclaw doctor` | Generate a diagnostic bundle for support |
| `nativeclaw status` | Bridge health snapshot |

---

## Features

- **🤖 Multi-backend** — Claude, Codex (OpenAI), and OpenRouter profiles (Kimi, MiniMax, Grok, etc.)
- **💬 Telegram** — Text + voice messages. Replies in the same chat.
- **🧠 Persistent memory** — SOUL.md, MEMORY.md, daily logs. Survives reboots.
- **📅 Crons** — Morning brief, heartbeat, session audit, tasks queue recovery
- **🎙 Voice** — xAI Grok STT transcription (fast + cheap; OpenAI Whisper API as fallback)
- **🔧 MCP tools** — QMD memory, Google Calendar, reminders, email, 25+ tools
- **🌐 Cross-platform** — macOS (launchd), Linux (systemd), Windows (Task Scheduler)
- **📦 Zero-config backups** — One-command zip + restore

---

## Architecture

```
User (Telegram) → Bridge (Node.js) → Backend Subprocess → Response → Telegram
                          ↓
            Cron Scheduler → MCP Servers → Workspace
```

The bridge is the heart: it polls Telegram, routes to the active backend,
manages sessions, schedules crons, and wires 25+ MCP servers.

---

## Version History

| Version | Date | What's New |
|---------|------|-----------|
| v2.0.0 | 2026-05 | Setup wizard, settings UI, Windows port, voice (xAI Grok STT), OpenRouter profiles, `/compact`, `/stats` context window |
| v1.10.4 | 2026-04 | Tool router, OpenCode lanes, cron routing fixes |
| v1.10.0 | 2026-04 | Agent reliability stack — memory, MCP health, context preservation |
| v1.9.x | 2026-03 | Codex-OpenRouter integration, subagent background workers |
| v1.0.x | 2026-01 | First release — Claude + Telegram bridge |

---

## License

MIT © Jamiah Bartlett
