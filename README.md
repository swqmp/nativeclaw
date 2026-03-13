# NativeClaw

A personal AI agent powered by Claude Code, running as a persistent background service on macOS or Linux, accessible through Telegram.

NativeClaw gives you a 24/7 AI assistant that:
- Responds to your Telegram messages using Claude Code
- Runs scheduled tasks (morning briefs, end-of-day summaries, heartbeat checks)
- Maintains persistent memory across conversations
- Manages itself via macOS launchd or Linux systemd (auto-restarts, survives reboots)
- Supports image analysis, model switching, extended thinking

## Requirements

- **macOS or Linux** (uses launchd on macOS, systemd on Linux)
- **Claude Max subscription** (provides Claude Code CLI access)
- **Node.js** (v18+)
- **Telegram account** + a bot from [@BotFather](https://t.me/BotFather)

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/nativeclaw.git
cd nativeclaw
bash setup.sh
```

The setup wizard will:
1. Check prerequisites (Node.js, Claude CLI)
2. Walk you through Telegram bot setup
3. Let you choose a default model
4. Install all files to `~/.claude/`
5. Save your auth token
6. Install and optionally start the service (launchd on macOS, systemd on Linux)

On first message to your bot, NativeClaw enters **onboarding mode** — it interviews you to set up its personality, learn about you, and configure itself as your personal agent.

## Architecture

```
You (Telegram) → Bridge (Node.js) → Claude Code CLI (claude -p) → Response → Telegram
                    ↓
              Cron Scheduler → Scheduled tasks (morning brief, heartbeat, etc.)
```

- **Bridge** (`bridge.js`) — Polls Telegram for messages, spawns `claude -p` subprocesses, sends responses back
- **Service manager** — launchd (macOS) or systemd (Linux) keeps the bridge running 24/7, restarts on crash, cycles every 71 hours
- **Workspace** — Agent's brain: personality (SOUL.md), rules (AGENTS.md), memory (MEMORY.md), tools (.mcp.json)

## File Structure

```
~/.claude/
├── telegram-bridge/
│   ├── bridge.js          # Core bridge
│   ├── config.json        # Your bot token, chat ID, settings
│   └── state.json         # Session state (auto-managed)
├── workspace/
│   ├── CLAUDE.md          # Agent instructions + onboarding
│   ├── SOUL.md            # Agent personality
│   ├── AGENTS.md          # Agent rules
│   ├── MEMORY.md          # Persistent memory
│   ├── USER.md            # Info about you
│   ├── .mcp.json          # MCP server configs
│   └── memory/            # Daily logs
├── scripts/
│   ├── claude-restart.sh  # Lifecycle manager
│   └── telegram_direct.sh # Direct Telegram messaging (for crons)
├── cron-schedule.json     # Scheduled tasks
├── .session-token         # Claude auth token
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

### Logs (both platforms)

```bash
tail -f ~/.claude/logs/telegram-bridge.log
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
