# NativeClaw Operations Guide

## What Is This?

NativeClaw is a Telegram bridge plus a service manager.

The bridge polls Telegram, routes user messages to the active backend, sends responses back, and runs scheduled jobs. The active backend can be Claude Code or Codex CLI.

```text
Telegram -> bridge.js -> Claude or Codex -> Telegram
                  ↓
             cron scheduler
```

## File Locations

| File | Purpose |
|---|---|
| `~/.claude/telegram-bridge/bridge.js` | Main bridge runtime |
| `~/.claude/telegram-bridge/config.json` | Bot token, allowed chats, workspace paths |
| `~/.claude/telegram-bridge/state.json` | Backend, session/thread, settings, queue state |
| `~/.claude/telegram-bridge/eval-slash-commands.js` | Local command-surface regression checks |
| `~/.claude/workspace/` | Agent memory, rules, tools, prompts |
| `~/.claude/cron-schedule.json` | Bridge-level scheduled jobs |
| `~/.claude/logs/telegram-bridge.log` | Runtime log |
| `~/.codex/config.toml` | Codex MCP/tool config, if using Codex backend |

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
systemctl --user status nativeclaw
journalctl --user -u nativeclaw -f
```

Windows:

```cmd
schtasks /run /tn "NativeClaw"
schtasks /end /tn "NativeClaw"
schtasks /delete /tn "NativeClaw" /f
```

## When to Restart

| Change | Restart Needed? |
|---|---|
| `bridge.js` | Yes |
| `config.json` | Yes |
| service plist/unit/task XML | Reload service registration |
| `cron-schedule.json` | No, bridge reloads every 5 minutes |
| workspace memory/rule files | No, read by backend sessions |
| `.mcp.json` | Usually next backend run is enough |
| `~/.codex/config.toml` | Next Codex run is enough |

## Telegram Commands

| Command | What It Does |
|---|---|
| `/claude` | Use Claude backend |
| `/claude --full` | Claude with raw Codex replay |
| `/codex` | Use Codex backend |
| `/codex --full` | Codex with raw Claude replay |
| `/codex help` | List Codex model aliases |
| `/effort <low|medium|high|xhigh|max>` | Set reasoning effort |
| `/verbosity <default|low|medium|high>` | Set Codex verbosity |
| `/opus` | Opus 4.7 |
| `/opus4.6` | Opus 4.6 legacy alias |
| `/sonnet` | Sonnet 4.6 |
| `/haiku` | Haiku 4.5 |
| `/reset` | Clear current backend session/thread |
| `/fresh` | Alias for `/reset` |
| `/stop` | Abort running task and clear queue |
| `/stats` | Last response stats |
| `/session` | Session/thread info |
| `/status` | Backend/model/session status |
| `/restart` | Ask the service manager to restart the bridge |

## Backend Handoffs

Switching backends clears the stale target session/thread. Continuity comes from a generated handoff block, not from resuming old accumulated context.

- `/codex` creates a Claude-to-Codex summary with the latest exchange copied verbatim.
- `/claude` creates a Codex-to-Claude summary with the latest exchange copied verbatim.
- `--full` uses raw transcript replay instead of summary.
- Session-audit cron clears both Claude and Codex sessions after it runs.

This keeps handoffs useful without hauling an old target thread back into the context window.

## Verification

After changing the bridge:

```bash
node --check ~/.claude/telegram-bridge/bridge.js
node ~/.claude/telegram-bridge/eval-slash-commands.js
```

For Codex:

```bash
codex exec "Say OK" -c model_reasoning_effort='"xhigh"'
```

For Claude:

```bash
claude --help | grep -- --effort
```

## Common Problems

Bot not responding:
1. Check the service status.
2. Read `~/.claude/logs/telegram-bridge.log`.
3. Restart only after confirming the service or bridge changed.

Codex backend errors:
1. Confirm `codex` is on PATH.
2. Run a short `codex exec` smoke test.
3. Check `~/.codex/config.toml` if MCP tools are expected.

Claude auth errors:
1. Run `claude` interactively and re-auth.
2. Restart the bridge after auth is refreshed.

Cron not firing:
1. Check log for `Cron matched`.
2. Confirm `cron-schedule.json` has the job and no `disabled: true`.
3. Wait up to 5 minutes for bridge reload.

Voice transcription failing:
1. Confirm `openaiApiKey` exists in `config.json`.
2. Check the actual OpenAI API error in the bridge log.

## Hooks Pattern

Claude Code hooks live in `~/.claude/settings.json`. Two useful patterns:

- Memory check hook: injects "search memory first" reminders for historical questions.
- Feedback hook: injects "log this correction" reminders when the user corrects the agent.

Keep hooks small and file-based. They should enforce habits, not become another hidden app.

## Persistent Browser

For browser tasks with logged-in sessions, use the included Chromium helper:

```bash
bash ~/.claude/scripts/agent-browser.sh start
bash ~/.claude/scripts/agent-browser.sh status
bash ~/.claude/scripts/agent-browser.sh stop
```

Configure Playwright MCP to connect to `http://localhost:9222` if you want the agent to use that persistent browser.
