# TOOLS.md - Tool Reference

Document the tools, MCP servers, local scripts, credentials locations, and integration notes available to this NativeClaw instance.

## Bridge

- Runtime: `~/.claude/telegram-bridge/bridge.js`
- Config: `~/.claude/telegram-bridge/config.json`
- State: `~/.claude/telegram-bridge/state.json`
- Logs: `~/.claude/logs/telegram-bridge.log`
- Cron config: `~/.claude/cron-schedule.json`
- Slash command eval: `node ~/.claude/telegram-bridge/eval-slash-commands.js`

## Backends

Claude backend:
- Uses Claude Code CLI.
- MCP servers are configured through workspace `.mcp.json`.
- `/effort` maps to Claude `--effort`.

Codex backend:
- Uses Codex CLI.
- MCP/tool config should be mirrored in `~/.codex/config.toml`.
- `/effort` maps to `model_reasoning_effort`.
- `/verbosity` maps to `model_verbosity`.
- Telegram `max` effort maps to Codex `xhigh`.

## Telegram Commands

- `/claude`, `/claude --full`
- `/codex`, `/codex --full`, `/codex help`
- `/5.4`, `/5.4-mini`, `/5.3-codex`, `/5.2`, `/5.2-codex`, `/5.1-codex-max`, `/5.1-codex-mini`
- `/opus`, `/opus4.6`, `/sonnet`, `/haiku`
- `/effort <low|medium|high|xhigh|max>`
- `/verbosity <default|low|medium|high>`
- `/think`, `/stop`, `/reset`, `/fresh`, `/stats`, `/session`, `/status`, `/restart`, `/help`

## Common MCP Servers

Add actual server details below as you configure them.

- Calendar
- Email / IMAP / Gmail
- Drive / Docs / Sheets
- Project management
- CRM
- Browser / Playwright
- Memory search
- Reminders
- GitHub

## Local Scripts

Document scripts here after verifying them.

- Browser helper: `~/.claude/scripts/agent-browser.sh`
- Direct Telegram send helper: `~/.claude/scripts/telegram_direct.sh`

## Rule

When you successfully use a new local database, API, MCP server, script, or capability for the first time, add it to this file before ending the task.
