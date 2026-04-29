# Upgrading to v1.10 from v1.9.x

v1.10 is mostly additive, but **the bridge runtime did change in two ways** worth a quick look (session/backend behavior + file-type allowlist). Your existing Telegram/Claude/Codex setup keeps working with no config changes — but the new behavior is automatic, so a `git pull` + restart is enough.

## TL;DR

1. `git pull` in your nativeclaw checkout.
2. Replace your installed `bridge.js` with the new one (or re-run `setup.sh` — wizard is idempotent and will only copy missing files / ask about new optional pieces).
3. Restart the bridge.
4. Optional per-feature adoption below.

## What changed in the bridge runtime

### Session & backend behavior
- **Session day anchored at 05:00 ET** (configurable via `config.sessionTimeZone` or `NATIVECLAW_SESSION_TIMEZONE`). Sessions survive the midnight boundary — the daily `session-audit` cron is now a safety-net rotation trigger, not the primary kill.
- **Two-tier backend handoff** on `/claude` ↔ `/codex` switches: source-summary first, last-20-message raw transcript replay as fallback, no-op if neither tier produces context. The previous breadcrumb-pointer scheme is removed; if you had any custom code reading `breadcrumb` fields from `state.json`, drop it.
- **Per-day session/thread tracking:** `state.sessionDates` and `state.codexSessionDates` are new fields. The bridge back-fills them automatically from existing `state.sessions` / `state.codexSessions` on first start — no migration needed.
- **`SESSION_START_COMPLETED_TODAY` flag** prevents the SESSION START checklist from running on every fresh session of the same 5 AM session day. If you observe the checklist running mid-day after a fresh thread, check `state.sessionStartRanToday`.
- **Codex execution is serialized**: user turns and crons no longer race. If you had cron entries scheduled tightly against user activity, they will now queue instead of running concurrently.
- **Codex `CONTEXT_PROFILES` collapsed** from `chat`/`work`/`cron` to `chat`/`cron`. If you had custom `detectContextProfile()` overrides, remove them — the bridge no longer calls that function.

### File attachments
- **HEIC/HEIF (iPhone photos), RTF, ODT/ODS/ODP, EPUB, YAML/TOML, EML/MSG, TEX, IPYNB, `.log`, and `.ppt` (legacy Office)** now accepted by the document handler. No config change required.
- Image extension fallback (`.jpg/.png/.webp/.heic/...`) catches the case where Telegram strips MIME on document-style sends.

## What changed elsewhere (additive, opt-in)

- New files under `workspace/system/` (mcp-health, scripts, mcp/qmd, task-queue), `workspace/skills/`, `workspace/feedback/`, `hooks/`
- AGENTS.md got a full rewrite. `setup.sh` will **not** overwrite your existing AGENTS.md.
- `cron-schedule.example.json` has 4 new command-only crons (no LLM turn burned).
- `.mcp.json.example` has an opt-in QMD entry (`__qmd_disabled`).

## Adopting AGENTS.md

The new AGENTS.md codifies a lot of hard-won rules. If your current AGENTS.md is heavily customized, diff before replacing:

```bash
diff ~/.claude/workspace/AGENTS.md nativeclaw/workspace/AGENTS.md
```

You probably want to merge in:
- SESSION START 5-step (backup, daily logs, task queue, MCP health, greet)
- AFTER COMPACTION protocol
- Checkpoint format (6 mandatory fields)
- System file promotion table

## Adopting QMD semantic memory

1. Get a free Google AI API key at https://aistudio.google.com/apikey
2. Store in keychain:
   ```bash
   bash nativeclaw/workspace/system/scripts/keychain-add.sh GEMINI_API_KEY
   # or on Linux:
   bash nativeclaw/workspace/system/scripts/keychain-add-linux.sh GEMINI_API_KEY
   ```
3. Copy the QMD server: `cp -R nativeclaw/workspace/system/mcp/qmd ~/.claude/workspace/system/mcp/`
4. Add to your `.mcp.json` (or rename `__qmd_disabled` to `qmd` if you used the example):
   ```json
   "qmd": {
     "command": "node",
     "args": ["<workspace>/system/mcp/qmd/server.js"]
   }
   ```
5. Restart the bridge. The agent can now call `search_memory` / `reindex_memory` / `memory_stats`.

## Adopting MCP health monitoring

1. `cp -R nativeclaw/workspace/system/mcp-health ~/.claude/workspace/system/`
2. `cp nativeclaw/workspace/system/scripts/mcp-status.sh ~/.claude/workspace/system/scripts/`
3. Edit `~/.claude/workspace/system/mcp-health/mcp-criticality.json` — classify each MCP you use as `critical`, `important`, or `optional`.
4. Add the mcp-probe cron from `cron-schedule.example.json`:
   ```json
   {
     "name": "mcp-probe",
     "schedule": "*/15 * * * *",
     "timeout": 120,
     "command": "node $NATIVECLAW_WORKSPACE/system/mcp-health/probe.js > $HOME/.claude/logs/mcp-probe.log 2>&1"
   }
   ```
5. Bridge reloads cron every 5 min — no restart needed.

## Adopting the task queue + self-audit

1. Create the queue: `mkdir -p ~/.claude/workspace/system/task-queue && echo '{"tasks":[]}' > ~/.claude/workspace/system/task-queue/queue.json`
2. `cp nativeclaw/workspace/system/scripts/session-self-audit.js ~/.claude/workspace/system/scripts/`
3. Add the `task-queue-recovery` (LLM-driven) and `session-self-audit` (command-only) crons from `cron-schedule.example.json`.

## Adopting prompt hooks

1. `mkdir -p ~/.claude/hooks && cp nativeclaw/hooks/*.sh ~/.claude/hooks/ && chmod +x ~/.claude/hooks/*.sh`
2. Merge `nativeclaw/settings.example.json` into `~/.claude/settings.json` under the `hooks.UserPromptSubmit` array. The setup wizard does this automatically if you re-run it.
3. Optional: add client/lead names to `~/.claude/workspace/system/memory-hook-clients.txt` (one per line). These trigger the memory-check hook.

## Adopting the feedback loop

1. `cp -n nativeclaw/workspace/feedback/*.md ~/.claude/workspace/feedback/` (won't overwrite existing)
2. That's it. The new AGENTS.md tells the agent to read these files before producing repeatable output.

## Adopting keychain-based secrets

If you currently have API keys inline in `.mcp.json`:

1. `bash nativeclaw/workspace/system/scripts/keychain-add.sh <KEY_NAME>` for each key
2. Update `.mcp.json` entries: remove the inline `env.<KEY_NAME>`, wrap the MCP in `mcp-wrapper.js`:
   ```json
   "somemcp": {
     "command": "node",
     "args": ["<workspace>/system/mcp-health/mcp-wrapper.js", "original-command", "arg1", "arg2"]
   }
   ```
3. The wrapper loads `<KEY_NAME>` from keychain into the child process environment.

## Nothing is mandatory

Every new piece is opt-in. If you only want the updated AGENTS.md and the bundled skills, adopt just those. The bridge doesn't depend on any of it.

## Need help

- Runbooks: [OPERATIONS.md](OPERATIONS.md) — "Agent Reliability Stack (v1.10+)" section
- Changelog: [CHANGELOG.md](CHANGELOG.md)
