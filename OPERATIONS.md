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

## Hooks (Claude Code Settings)

Hooks run shell commands in response to Claude Code events. Configure them in `~/.claude/settings.json` under `"hooks"`. Two patterns that dramatically improve agent reliability:

### Memory Check Hook

Triggers when the user mentions a client, person, or historical event. Injects a reminder to search memory before responding.

Create a trigger file at `~/.claude/workspace/system/memory-hook-clients.txt` with one name per line:
```
client name
another client
lead name
```

Add to `settings.json` under `hooks.UserPromptSubmit`:
```json
{
  "type": "command",
  "command": "msg=$(jq -r '.tool_input.prompt // .tool_input.message // \"\"' 2>/dev/null | tr '[:upper:]' '[:lower:]'); clients=$(paste -sd'|' $HOME/.claude/workspace/system/memory-hook-clients.txt 2>/dev/null || echo ''); keywords='when did|what happened|do you remember|did we|last time|previously|how much|who is'; if echo \"$msg\" | grep -qiE \"$clients|$keywords\"; then jq -n '{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"additionalContext\": \"MEMORY CHECK: Search memory before responding with any historical claims.\"}}'; fi"
}
```

When you add a new client or lead, add their name to `memory-hook-clients.txt`. No bridge restart needed.

### Feedback Detection Hook

Triggers when the user's message sounds like a correction. Injects a reminder to log the feedback immediately.

Add as a second hook in the same `UserPromptSubmit` array:
```json
{
  "type": "command",
  "command": "msg=$(jq -r '.tool_input.prompt // .tool_input.message // \"\"' 2>/dev/null | tr '[:upper:]' '[:lower:]'); corrections='no,? not that|don.t do that|stop doing|that.s wrong|fix that|you forgot|you missed|go back|try again|i told you'; if echo \"$msg\" | grep -qiE \"$corrections\"; then jq -n '{\"hookSpecificOutput\": {\"hookEventName\": \"UserPromptSubmit\", \"additionalContext\": \"FEEDBACK DETECTED: The user may have corrected you. Log actionable feedback to the matching feedback/*.md file before continuing.\"}}'; fi"
}
```

### Why Hooks Matter

Without hooks, the agent relies entirely on its own discipline to search memory and log feedback. Hooks provide a mechanical enforcement layer — the bridge injects the reminder into the prompt before the agent sees it, so it can't skip the step.

## Persistent Browser (Optional)

For agents that need web browsing with persistent logins (Duo, OAuth, etc.):

1. Install Chromium separately from your personal browser:
   - macOS: `brew install --cask chromium` then `xattr -cr /Applications/Chromium.app`
   - Linux: `sudo apt install chromium-browser`

2. The repo includes `scripts/agent-browser.sh` — start/stop/status for a Chromium instance on CDP port 9222.

3. Configure Playwright MCP to connect via CDP instead of spawning its own browser:
   ```json
   "browser": {
     "command": "npx",
     "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
   }
   ```

4. Agent runs `bash ~/.claude/scripts/agent-browser.sh start` before browser tasks, `stop` when done. Logins and cookies persist in the profile across messages.

## REFERENCE.md Pattern

As MEMORY.md grows past ~150 lines, split it:
- **MEMORY.md** (~100-150 lines): Active context — current projects, pipeline, team, revenue
- **REFERENCE.md** (~150+ lines): Static reference — devices, infrastructure, credentials notes, calendar color maps, folder structure

Don't load REFERENCE.md into the system prompt. Index it in your search tool (e.g., QMD) so the agent can look it up on demand without burning context on every message.

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
