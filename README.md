# NativeClaw

A personal AI agent powered by Claude Code, running as a persistent background service on macOS, Linux, or Windows, accessible through Telegram.

NativeClaw gives you a 24/7 AI assistant that:
- Responds to your Telegram messages using Claude Code
- Runs scheduled tasks (morning briefs, end-of-day summaries, heartbeat checks)
- Maintains persistent memory across conversations
- Manages itself via macOS launchd, Linux systemd, or Windows Task Scheduler (auto-restarts, survives reboots)
- Supports image analysis, voice messages, file attachments, model switching, extended thinking

## What's New in v1.7.0

- **Codex provider support** — Set `"provider": "codex"` in config.json to use OpenAI Codex CLI instead of Claude Code. Useful for teams running both, or for users who want to run NativeClaw on top of a different model.

## What's New in v1.6.0

- **Lightweight cron context** — Crons load ~80 lines instead of your full system prompt. Faster, cheaper, no identity confusion.
- **Checkpoint enforcement** — Bridge automatically reminds the agent to write memory after 8 exchanges. No more memory loss from long sessions.
- **Identity prefix pattern** — Cron prompts include agent identity, preventing "I'm a Claude Code UI" confusion.
- **Persistent browser** — Shared Chromium via CDP so logins survive across messages.
- **Eval framework** — Weekly self-evaluation with scored metrics.
- **Hooks documentation** — Memory-check and feedback-detection hooks with file-based trigger lists.

See [CHANGELOG.md](CHANGELOG.md) for full details.

## Requirements

- **macOS, Linux, or Windows** (uses launchd on macOS, systemd on Linux, Task Scheduler on Windows)
  - Windows requires [Git Bash / MSYS2](https://gitforwindows.org/) to run `setup.sh`
- **Claude Max subscription** (provides Claude Code CLI access)
- **Node.js** (v18+)
- **Telegram account** + a bot from [@BotFather](https://t.me/BotFather)
- **Whisper** (optional, for voice message transcription) — `pip install openai-whisper`

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/nativeclaw.git
cd nativeclaw
bash setup.sh
```

> **Windows users:** Run this in Git Bash or MSYS2, not Command Prompt or PowerShell.

> [!WARNING]
> **Windows — Run PowerShell as Administrator (required)**
> 
> Before running setup or any `.ps1` scripts, open PowerShell as Administrator and run:
> ```powershell
> Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> This is a one-time step. Without it, Windows will block all PowerShell scripts and the bridge won't start.
> 
> To open PowerShell as Administrator: right-click the Start button → **Windows PowerShell (Admin)** or **Terminal (Admin)**.
> You do NOT need admin for day-to-day use — only for this one-time setup step.

The setup wizard will:
1. Check prerequisites (Node.js, Claude CLI)
2. Walk you through Telegram bot setup
3. Let you choose a default model
4. Install all files to `~/.claude/`
5. Save your auth token
6. Install and optionally start the service (launchd on macOS, systemd on Linux, Task Scheduler on Windows)

On first message to your bot, NativeClaw enters **onboarding mode** — it interviews you to set up its personality, learn about you, and configure itself as your personal agent.

## Architecture

```
You (Telegram) → Bridge (Node.js) → Claude Code CLI (claude -p) → Response → Telegram
                    ↓
              Cron Scheduler → Scheduled tasks (morning brief, heartbeat, etc.)
```

- **Bridge** (`bridge.js`) — Polls Telegram for messages, spawns `claude -p` subprocesses, sends responses back
- **Service manager** — launchd (macOS), systemd (Linux), or Task Scheduler (Windows) keeps the bridge running 24/7, restarts on crash, weekly restart for hygiene
- **Workspace** — Agent's brain: personality (SOUL.md), rules (AGENTS.md), memory (MEMORY.md), tools (.mcp.json)

## File Structure

```
~/.claude/
├── telegram-bridge/
│   ├── bridge.js          # Core bridge (v1.6.0)
│   ├── config.json        # Your bot token, chat ID, settings
│   └── state.json         # Session + exchange counter state (auto-managed)
├── workspace/
│   ├── CLAUDE.md          # Agent instructions + onboarding
│   ├── SOUL.md            # Agent personality
│   ├── AGENTS.md          # Agent rules (keep under 200 lines)
│   ├── MEMORY.md          # Active business context
│   ├── USER.md            # Info about you
│   ├── TOOLS.md           # Tool reference
│   ├── HEARTBEAT.md       # Heartbeat instructions
│   ├── .mcp.json          # MCP server configs
│   ├── memory/            # Daily logs
│   ├── feedback/          # Output feedback logs
│   ├── cron/
│   │   └── CONTEXT_LITE.md  # Condensed context for crons
│   ├── cron-workspace/
│   │   └── CLAUDE.md      # Lightweight cron system prompt
│   └── system/
│       └── EVAL_FRAMEWORK.md  # Weekly self-eval metrics
├── scripts/
│   ├── claude-restart.sh   # Lifecycle manager (macOS/Linux)
│   ├── claude-restart.ps1  # Lifecycle manager (Windows)
│   ├── telegram_direct.sh  # Direct Telegram messaging (macOS/Linux)
│   ├── telegram_direct.ps1 # Direct Telegram messaging (Windows)
│   └── agent-browser.sh   # Persistent Chromium for browser tasks
├── cron-schedule.json     # Scheduled tasks
└── logs/
    └── telegram-bridge.log
```

## Commands

### macOS (launchd)

```bash
# Start
launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist

# Restart
launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist && launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist
```

### Linux (systemd)

```bash
# Start
systemctl --user start nativeclaw

# Stop
systemctl --user stop nativeclaw

# Restart
systemctl --user restart nativeclaw

# Status
systemctl --user status nativeclaw
```

### Windows (Task Scheduler)

Run these in an admin terminal (Command Prompt or PowerShell):

```cmd
# Start
schtasks /run /tn "NativeClaw"

# Stop
schtasks /end /tn "NativeClaw"

# Delete (to reinstall)
schtasks /delete /tn "NativeClaw" /f
```

### Logs

```bash
# macOS / Linux
tail -f ~/.claude/logs/telegram-bridge.log

# Windows
type %USERPROFILE%\.claude\logs\telegram-bridge.log
```

## Telegram Commands

| Command | Description |
|---|---|
| `/opus` | Switch to Opus 4.6 |
| `/sonnet` | Switch to Sonnet 4.6 |
| `/haiku` | Switch to Haiku 4.5 |
| `/think` | Toggle extended thinking |
| `/stop` | Abort running task and clear queue |
| `/reset` | Start fresh conversation |
| `/stats` | Last response stats |
| `/status` | System status |
| `/help` | All commands |

## Supported Media

| Type | How It Works |
|---|---|
| **Text** | Sent directly to Claude |
| **Images** | Downloaded, passed to Claude for visual analysis |
| **Voice messages** | Transcribed locally with Whisper, sent as text to Claude |
| **Audio files** | Same as voice — transcribed with Whisper |
| **Files** (PDF, DOCX, XLSX, PPTX, TXT, CSV, JSON, Markdown) | Downloaded, passed to Claude for reading |

Send a file with a caption to tell the agent what to do with it. No caption defaults to "Read and summarize."

## Provider Options

NativeClaw defaults to Claude Code (`claude` CLI) but can be switched to OpenAI Codex CLI by setting `provider` in your `config.json`:

```json
{
  "provider": "claude"
}
```

| Value | CLI | Notes |
|---|---|---|
| `"claude"` (default) | `claude -p` | Full session resumption via `-r` flag. Requires Claude Max subscription. |
| `"codex"` | `codex --approval-mode full-auto` | Stateless — no session resumption between messages. Requires OpenAI Codex CLI installed and authenticated. |

When using `"provider": "codex"`, available model aliases change to:

| Alias | Model |
|---|---|
| `mini` | `codex-mini-latest` |
| `codex-mini` | `codex-mini-latest` |
| `o4-mini` | `o4-mini` |
| `o3` | `o3` |

**Note:** Codex sessions are stateless. Each message starts fresh — there is no equivalent to Claude's session resumption (`-r` flag). For persistent memory across messages, the agent must write to workspace files (MEMORY.md, daily logs) rather than relying on conversation history.

## Customization

NativeClaw is designed to be personalized. Edit the workspace files to make the agent yours:

- **SOUL.md** — Who is your agent? Name, personality, voice
- **AGENTS.md** — How should it operate? Rules, autonomy level, error handling
- **MEMORY.md** — What should it remember? Projects, clients, preferences
- **cron-schedule.json** — What should it do automatically? Briefings, checks, reports
- **.mcp.json** — What tools does it have? Email, calendar, project management

See [OPERATIONS.md](OPERATIONS.md) for the full operations guide.

## License

Private. Do not distribute.
