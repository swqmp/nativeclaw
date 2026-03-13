# NativeClaw Operations Guide

## What Is This?

NativeClaw is a personal AI agent powered by Claude Code, running as a background service on your Mac, accessible via Telegram.

Two parts:
1. **Telegram bridge** (`bridge.js`) — polls your bot for messages, spawns `claude -p` to handle them, sends responses back, runs crons
2. **launchd** — macOS service manager that keeps the bridge running, restarts on crash, starts on boot, cycles every 71 hours

## Commands

### Restart
```bash
launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist && launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist
```

### Stop
```bash
launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist
```

### Start
```bash
launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist
```

### Check Status
```bash
launchctl list | grep nativeclaw
```

### View Logs
```bash
# Activity log (messages, crons, errors)
tail -30 ~/.claude/logs/telegram-bridge.log

# Watch live
tail -f ~/.claude/logs/telegram-bridge.log

# Startup log
tail -30 ~/.claude/logs/restart.log
```

## When to Restart

| What you changed | Restart needed? |
|---|---|
| CLAUDE.md, SOUL.md, AGENTS.md, MEMORY.md | No |
| Cron schedule | No (reloads every 5 min) |
| MCP config (.mcp.json) | No |
| bridge.js | Yes |
| Auth token (.session-token) | Yes |
| Restart script | Yes |

## What Happens When...

| Scenario | What Happens |
|---|---|
| Close laptop | Suspends, resumes when opened |
| Internet drops | Bridge retries, reconnects automatically |
| Bridge crashes | launchd restarts it within 30 seconds |
| Mac reboots | launchd starts it on boot |
| 71 hours pass | launchd cycles the bridge fresh |
| Message while busy | Queued, processed when current task finishes |

## Telegram Commands

| Command | What It Does |
|---|---|
| `/model` | Show current model |
| `/model sonnet` | Switch model |
| `/opus` | Switch to Opus 4.6 |
| `/sonnet` | Switch to Sonnet 4.6 |
| `/haiku` | Switch to Haiku 4.5 |
| `/think` | Toggle extended thinking |
| `/reset` | Clear session, start fresh |
| `/stats` | Last response stats |
| `/status` | System status |
| `/help` | Show all commands |

## File Locations

| File | What It Is |
|---|---|
| `~/.claude/telegram-bridge/bridge.js` | Bridge code |
| `~/.claude/telegram-bridge/config.json` | Bot token, chat ID, settings |
| `~/.claude/.session-token` | Claude auth token |
| `~/.claude/scripts/claude-restart.sh` | Startup script |
| `~/.claude/cron-schedule.json` | Cron job definitions |
| `~/.claude/workspace/CLAUDE.md` | Agent instructions |
| `~/.claude/workspace/.mcp.json` | MCP server configs |
| `~/.claude/logs/telegram-bridge.log` | Activity log |

## Troubleshooting

**Bot not responding?**
1. Check status: `launchctl list | grep nativeclaw`
2. Check logs: `tail -20 ~/.claude/logs/telegram-bridge.log`
3. Restart: unload then load

**"Not logged in" errors?**
Auth token expired. Open a terminal, run `claude`, then:
```bash
echo "$CLAUDE_CODE_SESSION_ACCESS_TOKEN" > ~/.claude/.session-token
```
Then restart.

**Cron not firing?**
Check the log for "Cron matched" entries. The bridge reloads the schedule every 5 minutes.
