# Upgrading NativeClaw

This doc serves two audiences:

1. **The agent** (Claude/Codex inside your install) — uses these instructions when you ask "check for updates" or similar.
2. **You** — if you want to upgrade manually, the legacy v1.9 → v1.10 manual notes are preserved at the bottom for reference.

The default and recommended path is the **agent-driven conversational flow** described first.

---

## Agent-driven upgrade flow

When the user says anything like:

- "check for updates"
- "any new nativeclaw releases?"
- "upgrade me"
- "is there a new version?"
- "what's new on the repo?"

…the agent should run this flow. **Do not run the flow when there are no updates available** — just say "you're on latest, vX.Y.Z."

### Step-by-step

**1. Detect installed version + fetch available releases.**

```bash
bash $HOME/.claude/workspace/system/scripts/check-updates.sh
```

Returns JSON:

```json
{
  "current_version": "v1.10.3",
  "repo": "swqmp/nativeclaw",
  "source_cache": "/Users/.../.nativeclaw-source",
  "cache_status": "fetched",
  "releases": [
    { "tag": "v1.10.4", "name": "...", "published_at": "...", "url": "...", "body": "..." },
    ...
  ]
}
```

If `current_version` is `"unknown"`, the user is on a pre-VERSION-file install — propose creating the file at the closest tag they remember. If you can't determine, default to running setup.sh fresh.

**2. Identify the gap.** Filter `releases` to only tags newer than `current_version`. If empty, tell the user they're on latest and stop.

**3. Summarize the gap.** For each newer release, surface:
- The tag and release name
- A digest of the release notes (`body`)
- The publish date

Don't dump full release notes verbatim unless asked — summarize.

**4. Pull source for diffing.** The check-updates script maintains a clone at `$SOURCE_CACHE` (default `~/.nativeclaw-source`). Use it:

```bash
cd ~/.nativeclaw-source
git diff <user-installed-tag>..<latest-tag> --stat
git diff <user-installed-tag>..<latest-tag> -- <specific-file>
```

**5. Categorize changed files** into four buckets:

| Bucket | Files | Default action |
|---|---|---|
| **Auto-apply** | `scripts/*`, `setup.sh`, `bridge/eval-slash-commands.js`, `system/scripts/*`, `system/mcp-health/*`, `hooks/*` | Overwrite (rarely user-edited) |
| **Merge needed** | `bridge/bridge.js`, `workspace/AGENTS.md`, `workspace/NATIVECLAW.md`, `OPERATIONS.md`, `README.md`, `workspace/CLAUDE.md` | Show diff, ask user — keep mine, take new, or 3-way merge |
| **Skip — user content** | `workspace/SOUL.md`, `workspace/USER.md`, `workspace/MEMORY.md`, `workspace/TOOLS.md`, `workspace/feedback/*`, `workspace/memory/*`, `workspace/HEARTBEAT.md`, `.mcp.json`, `cron-schedule.json`, `bridge/config.json` | Never touch |
| **New file** | Files added in upstream not present locally | Show, ask whether to add |

**6. Walk the user through merge-needed files.** For each one:
- Show the upstream diff (formatted, focus on hunks not metadata)
- Read the user's installed file, identify potential conflicts
- Offer three paths:
  - **Keep mine** — skip the file
  - **Take new** — overwrite with upstream
  - **Merge guided** — apply non-conflicting hunks, surface conflicts for user decision

**7. Apply approved changes.** Write the approved files. After all writes:
- Update `$HOME/.claude/workspace/VERSION` to the new tag
- If any of `bridge/*` or `scripts/*` changed, tell the user to restart the bridge:
  - macOS: `launchctl kickstart -k gui/$(id -u)/com.nativeclaw.session`
  - Linux: `systemctl --user restart nativeclaw.service`
- If MCP-related files changed, suggest a fresh bridge restart so MCP servers reload.

**8. Confirm.** Report what was applied, what was skipped, and the new version.

### Files the agent must NEVER touch on upgrade

These are user content and personality:
- `workspace/SOUL.md`, `USER.md`, `MEMORY.md`, `TOOLS.md`, `HEARTBEAT.md`
- `workspace/feedback/*` — user's correction history
- `workspace/memory/*` — daily logs, ephemeral
- `.mcp.json` — user secrets/config
- `cron-schedule.json` — user's cron customizations
- `bridge/config.json` — user's bridge config (token, allowed chats, model preferences)

If a user explicitly asks to merge in changes from these files (rare), do it interactively, not silently.

### When `gh` or `jq` isn't installed

- `check-updates.sh` falls back to `curl` if `gh` is missing.
- `jq` is required. If missing, the script exits with an error message — instruct the user to install (`brew install jq` on macOS, `apt-get install jq` / `dnf install jq` on Linux).

---

## Manual upgrade (if the agent flow fails or you prefer hand-driven)

If the agent flow doesn't fit your install, or you want to upgrade by hand:

```bash
cd ~/path/to/your/nativeclaw-clone
git fetch --tags
git checkout <new-tag>
# Compare to your live install
diff bridge/bridge.js ~/.claude/telegram-bridge/bridge.js
diff workspace/AGENTS.md ~/.claude/workspace/AGENTS.md
# Apply selectively, then:
echo "<new-tag>" > ~/.claude/workspace/VERSION
launchctl kickstart -k gui/$(id -u)/com.nativeclaw.session   # macOS
# or
systemctl --user restart nativeclaw.service                  # Linux
```

---

## Legacy: Upgrading from v1.9.x to v1.10

(Kept for users still on v1.9 — manual upgrade reference.)

v1.10 is mostly additive. Your existing Telegram/Claude/Codex setup keeps working after `git pull` + restart. Add `agentName` and `userName` to `config.json` if you want the generic bridge prompts to use your agent/user names.

### TL;DR

1. `git pull` in your nativeclaw checkout.
2. Replace your installed `bridge.js` with the new one (or re-run `setup.sh` — wizard is idempotent and will only copy missing files / ask about new optional pieces).
3. Restart the bridge.
4. Optional per-feature adoption below.

### What changed in the bridge runtime

#### Session & backend behavior
- **Session day anchored at 05:00 ET** (configurable via `config.sessionTimeZone` or `NATIVECLAW_SESSION_TIMEZONE`). Sessions survive the midnight boundary — the daily `session-audit` cron is now a safety-net rotation trigger, not the primary kill.
- **Gap transcript backend switching** on `/claude` ↔ `/codex`: the bridge resumes the target backend's same-day session/thread, then injects the other backend's most recent user/assistant text gap with simple timestamp framing. No LLM summary call is made during the switch. Gap transcript blocks are capped at 50k characters and drop oldest entries first.
- **Arrival-boundary state:** `state.arrivedAt[chatId][backend]` tracks when the user most recently arrived at each backend. Previous breadcrumb-pointer and LLM handoff-summary paths are removed.
- **Per-day session/thread tracking:** `state.sessionDates` / `state.codexSessionDates` are new fields. The bridge back-fills automatically on first start.
- **`SESSION_START_COMPLETED_TODAY` flag** prevents the SESSION START checklist from running on every fresh session of the same 5 AM session day.
- **Codex execution serialized**: user turns and crons no longer race.
- **Codex `CONTEXT_PROFILES` collapsed** from `chat`/`work`/`cron` to `chat`/`cron`.

#### Setup and config
- `setup.sh` supports Claude-only, Codex-only, or both. Claude CLI is no longer required if you choose Codex-only.
- `setup.sh` asks for agent name and user name, writes `agentName` / `userName` to `~/.claude/telegram-bridge/config.json`.
- Existing installs add manually:
  ```json
  "agentName": "Whet",
  "userName": "Jamiah",
  "firstRunOnboarding": true
  ```

#### File attachments
- HEIC/HEIF (iPhone photos), RTF, ODT/ODS/ODP, EPUB, YAML/TOML, EML/MSG, TEX, IPYNB, `.log`, and `.ppt` (legacy Office) now accepted by the document handler.

### Adopting AGENTS.md

The new AGENTS.md codifies hard-won rules. If your current AGENTS.md is heavily customized:

```bash
diff ~/.claude/workspace/AGENTS.md nativeclaw/workspace/AGENTS.md
```

Worth merging in:
- SESSION START 5-step (backup, daily logs, task queue, MCP health, greet)
- AFTER COMPACTION protocol
- Checkpoint format (6 mandatory fields)
- System file promotion table

### Adopting QMD semantic memory

Optional. Rename `__qmd_disabled` to `qmd` in your `.mcp.json` to enable. Set `GEMINI_API_KEY` in your keychain (or `.env`).
