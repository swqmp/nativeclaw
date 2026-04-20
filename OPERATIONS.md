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

## Agent Reliability Stack (v1.10+)

### Memory + Feedback Loop

- **Daily logs:** agent writes checkpoints to `workspace/memory/YYYY-MM-DD.md`. Required fields: What we did / Decisions / Open questions / Next actions / Feedback logged / MEMORY.md delta. See `workspace/AGENTS.md` for the canonical format.
- **Durable context:** promote to `workspace/MEMORY.md` anything that will matter next week. Promotion triggers and a target-file table are in AGENTS.md.
- **Correction log:** `workspace/feedback/<task-type>.md`. When the user corrects the agent mid-task, the agent logs it immediately. Before producing repeatable output (email, report, etc.) the agent reads the matching file first. **Path format is `feedback/general.md`, NOT `feedback_general.md`** — underscore-at-root writes go nowhere.
- **Snapshots:** `bash workspace/system/scripts/snapshot-memory.sh` copies MEMORY.md to `memory/snapshots/` (keeps last 30). Wired as the `snapshot-memory` cron at 5:05 AM daily.

### QMD Semantic Memory Search (optional)

QMD gives the agent a `search_memory` MCP tool backed by Gemini Embedding 2 across every memory/feedback file.

- Enable during `setup.sh` (prompts for Google AI key, stores in OS keychain).
- To enable later:
  1. `bash workspace/system/scripts/keychain-add.sh GEMINI_API_KEY` (macOS) or `keychain-add-linux.sh` (libsecret).
  2. Edit `workspace/.mcp.json` — rename `__qmd_disabled` to `qmd`, drop `__note_qmd`.
  3. Restart the bridge.
- Reindex: `mcp__qmd__reindex_memory` from inside the agent, or run the direct runner at `workspace/system/scripts/qmd-reindex-direct.js` for command-only crons.

### Keychain Rotation

API keys should live in the OS keychain, NOT in `.mcp.json` or shell rc files.

- macOS: `bash workspace/system/scripts/keychain-add.sh <KEY_NAME>`
- Linux: `bash workspace/system/scripts/keychain-add-linux.sh <KEY_NAME>` (requires `libsecret-tools` / `libsecret`)
- Reference in code via `process.env.<KEY_NAME>` — the MCP wrapper loads from keychain at boot.
- Rotating: re-run the same add script; it updates in place.

### MCP Health

- **Probe:** `workspace/system/mcp-health/probe.js` runs every 15 min (cron: `mcp-probe`). Writes `probe-state.json`.
- **Status triage:** `bash workspace/system/scripts/mcp-status.sh [--quiet]` — silent if all Critical MCPs healthy + probe fresh (<120 min); loud otherwise. Use `--quiet` in session-start checklists.
- **Criticality map:** `workspace/system/mcp-health/mcp-criticality.json` classifies each MCP as `critical` / `important` / `optional`. Agent checks before claiming a tool is "broken."
- **Wrapper:** `workspace/system/mcp-health/mcp-wrapper.js` is a reusable init-replay supervisor. Wrap flaky MCPs in `.mcp.json` by setting `command: node` and `args: [.../mcp-wrapper.js, <original-command>, ...]`.

### Task Queue + Self-Audit

- **Queue:** `workspace/system/task-queue/queue.json` stores tasks carried over from rate-limits/crashes. Recovered hourly by the `task-queue-recovery` cron. Format and status values in `task-queue/README.md`.
- **Self-audit:** `workspace/system/scripts/session-self-audit.js` runs at 10am/2pm/6pm/10pm (cron: `session-self-audit`). Scans recent transcript lines for unkept commitments, unlogged corrections, stale checkpoints. Log-only — no user interruption.

### Prompt Hooks

Two `UserPromptSubmit` hooks ship in `hooks/` and get wired into `~/.claude/settings.json` by `setup.sh`:

- `hooks/memory-check.sh` — injects "⚡ MEMORY CHECK" additionalContext when the user mentions a name from `workspace/system/memory-hook-clients.txt` or uses history phrasing ("when did", "last time", "do you remember", etc.). Forces the agent to call `search_memory` before answering from injected context.
- `hooks/feedback-check.sh` — injects "⚠️ FEEDBACK DETECTED" when the user pushes back ("no", "don't", "stop doing that"). Forces the agent to log the correction before continuing.

To enable client-name triggers, add one name per line to `workspace/system/memory-hook-clients.txt`.

### Secrets Scan

`workspace/system/scripts/scan-secrets.sh` sweeps the workspace for accidentally-committed API keys, passwords, and tokens. Cron: `secrets-scan` at 7:15 AM daily, log-only. Configure ignore patterns in `workspace/.secretsignore`.

## Hooks Pattern

Claude Code hooks live in `~/.claude/settings.json`. The two v1.10 hooks described above are wired automatically. Roll your own by dropping a `.sh` into `hooks/`, making it executable, and adding an entry under `hooks.UserPromptSubmit`. Keep them small and file-based.

## Persistent Browser

For browser tasks with logged-in sessions, use the included Chromium helper:

```bash
bash ~/.claude/scripts/agent-browser.sh start
bash ~/.claude/scripts/agent-browser.sh status
bash ~/.claude/scripts/agent-browser.sh stop
```

Configure Playwright MCP to connect to `http://localhost:9222` if you want the agent to use that persistent browser.
