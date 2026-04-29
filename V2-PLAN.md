# NativeClaw v2.0 — Plan

**Status:** Scoped, not started · **Author:** Jamiah Bartlett (with Whet) · **Date:** 2026-04-29

A major release. v2.0 turns NativeClaw from "a CLI tool you set up in a terminal" into "an installable assistant with a visual setup flow and a persistent control panel." The core agent runtime stays the same — what changes is the surface around it.

---

## Why v2.0 (not v1.11)

The setup wizard alone would be a v1.11. Adding a persistent settings UI, backup/restore, diagnostic dump, and Windows support is a categorical jump in what the project ships. Power users still get `setup.sh` + raw JSON config. Non-technical users get a browser-based install + control panel. Both paths produce the same install.

This is the friction reduction we've been pointing at for months — making NativeClaw something Jamiah could actually post about and have non-developer friends successfully install.

---

## Goals

1. **Lower setup friction** for users who have never opened a terminal. Browser-driven install, prereqs auto-detected and installable in one click, OAuth handoffs that don't confuse anyone.
2. **Provide a persistent settings UI** so config edits don't require finding and editing JSON files.
3. **Cross-platform parity** — Mac, Linux, and Windows installs all work the same way. Windows is new.
4. **Backup/restore + diagnostic dump** so users don't lose their workspace on machine swaps, and can ship a useful bundle when something breaks.
5. **Preserve existing CLI path** — `setup.sh` stays as a first-class option for power users.

---

## Non-goals (explicitly out of v2.0)

- Skill marketplace
- Voice-out / TTS replies
- Group chat / multi-user installs
- Mobile-native app
- Public deploys (settings UI is **localhost-only**, hard line)
- Cron schedule LLM-natural-language editor (raw form editor only)

These come later if at all.

---

## Scope

### A. Setup wizard (`bash install.sh` → browser)

Single bash command kicks off a Node-based local server on `127.0.0.1:9292` (auto-pick next port if taken). Server runs the user through a six-page flow:

| # | Page | Content |
|---|------|---------|
| 1 | Welcome + prereq check | Detect Node, Claude CLI, Codex CLI; one-click install missing prereqs (streams output via SSE). |
| 2 | Backend choice | Claude only / Codex only / Both. One-line pricing context per option. |
| 3 | Agent identity | Agent name, user name, optional vibe template (3-4 SOUL.md presets — sharp / friendly / professional / custom). |
| 4 | Telegram connection | Paste bot token (validated via `getMe` before accepting), then "send a message to your bot" — page polls `getUpdates` and auto-detects chat ID. |
| 5 | Optional features | Toggles for QMD memory + voice transcription. Google Workspace deferred to settings UI Connections tab. |
| 6 | Install + verify | Live-streamed log: writes config, registers service, starts bridge, tests round-trip. Final state: "Send a message to your bot" + button that opens the bot's Telegram chat. |

#### OAuth handoff convention
Any step that requires a separate browser tab (Claude OAuth, Google OAuth) follows the same pattern:

1. Wizard shows: *"We'll open a new tab for [service] auth. Come back here when you see the success page and click Continue."*
2. New tab opens (target=_blank or window.open).
3. Wizard polls server endpoint that watches for the auth completion signal.
4. On success, wizard advances. On timeout, "didn't work? click here to retry."

This solves the "why is my wizard tab broken" problem if the OAuth callback redirect interferes with the wizard's session.

#### Stuck-step recovery
Every wizard step has three options:
- **Retry** — re-run the same action
- **Skip for now** — defer the step, log it, surface in settings UI later
- **Edit manually** — show the file path the user can edit themselves

No step blocks the wizard indefinitely. Errors surface the actual failure (not "see logs"), and provide an actionable next step.

### B. Settings UI (`nativeclaw settings`)

CLI command starts the server on demand at `127.0.0.1:9292`. Shuts down after 30 minutes idle. Same server, different routes from setup wizard. Inline help text for every field — clicking a "?" reveals one or two sentences of explanation.

Tabs:

| Tab | Contents |
|-----|----------|
| **Status** | Bridge alive/dead, MCP health, last cron run, `/usage` snapshot for Claude + Codex, last 5 messages timestamps |
| **Config** | Edit `bridge/config.json` fields with form validation (model, allowed chat IDs, agent/user names, effort, verbosity) |
| **MCP servers** | Toggle each MCP on/off, see auth status (keychain entry exists?), test each with one click |
| **Cron schedule** | Form-based editor for `cron-schedule.json` — add/remove/edit jobs, no raw JSON required |
| **Connections** | Google Workspace OAuth status + setup, Telegram bot info, voice transcription provider choice, QMD on/off, GitHub PAT |
| **Logs** | Tail recent `telegram-bridge.log` + one-click "Export diagnostic bundle" zip |
| **Backup / Restore** | Download workspace as zip; upload zip to restore on new machine. Excludes secrets. |

### C. Cross-platform support

| Platform | Service mgr | Path conventions | Keychain | Notes |
|----------|------------|------------------|----------|-------|
| macOS | launchd | `~/...` | `security` | Current primary; minimal change |
| Linux | systemd user | `~/...` | `secret-tool` (libsecret) | Already supported; validate parity |
| Windows | **Task Scheduler** | `%USERPROFILE%\...` | DPAPI / Credential Manager | **NEW.** Major lift. |

Windows specifics to figure out:
- PowerShell equivalents for `bash install.sh` and `bash setup.sh` — likely `install.ps1` / `setup.ps1`
- Task Scheduler XML generation in lieu of launchd plist or systemd unit
- Keychain abstraction layer in `mcp-wrapper.js` to use Credential Manager API on Windows
- File path normalization (forward vs backslash) across all bash scripts; migrate to Node-based scripts where path handling matters
- Node prereq install: assume user has Node, or auto-install via winget?
- Setup wizard launcher: `install.bat` that bootstraps Node and starts the server

### D. Backup/restore

- **Backup:** zip `workspace/` minus `.mcp.json`, `bridge/config.json` secrets, and `feedback/`/`memory/` if user opts. Default includes everything except `.mcp.json` and `bridge/config.json`. Output: `nativeclaw-backup-YYYY-MM-DD.zip`.
- **Restore:** upload zip, prompt user before overwriting any existing files. Useful for new-machine migration.
- **Excluded by default:** `.mcp.json` (contains secrets in env vars), `bridge/config.json` (bot token), `bridge/state.json` (machine-specific session state), `bridge/bridge.pid`.

### E. Diagnostic dump

One-click button in Logs tab. Bundles:
- Last 200 lines of `telegram-bridge.log`
- Sanitized `state.json` (session IDs redacted)
- `system/mcp-health/last-probe.json`
- `restart.log` last 100 lines
- `package.json`, Node version, OS version
- VERSION file
- Recent cron run history

Outputs `nativeclaw-diag-YYYY-MM-DD-HHMM.zip`. User DMs the zip to whoever is supporting them; no live SSH required.

---

### F. Hermes-derived feature candidates (research-pending)

From Apr 28, 2026 research thread investigating the Hermes agent (competing personal-AI project). Three candidates surfaced as worth evaluating for v2.0 inclusion. Final yes/no decision pending tonight's deeper investigation.

| Candidate | What it is | Effort | Status |
|-----------|-----------|--------|--------|
| **Honcho dialectic user modeling** | Self-hosted user-modeling layer (`@honcho-ai/sdk`), runs alongside QMD. QMD = retrieval; Honcho = active user representation that updates as the agent learns about the user. Complementary, not redundant. | ~6-10 hrs | Worth doing — research validates fit before commit |
| **Self-improving skills (agentskills.io adoption)** | Portable open standard for agent skills/system prompts. The "self-improving" framing is mostly marketing; the real win is the **open standard** that lets skills move between agent platforms. | ~8-12 hrs | Worth doing but pace it — adopt the standard, skip the hype |
| **Interrupt + redirect** | Lets the user interrupt a running agent turn and redirect mid-stream. Pragmatic version: SIGTERM + auto-resume with a redirect-prompt prefix. True fork-CLI version is deferred. | ~3-5 hrs | Pragmatic version only — 80% of UX without forking the CLI |

**Decision gate before locking into v2.0:** Tonight's investigation pass should answer:
1. Honcho — is the user-modeling quality measurably better than QMD-only? Does docker-compose self-host on Nova add operational burden?
2. agentskills.io — is the standard live and stable enough to adopt, or still pre-1.0?
3. Interrupt+redirect — does the SIGTERM approach interact cleanly with our existing session-day anchor and Codex execution serialization?

Items that pass the gate get scoped into the appropriate Phase. Items that don't get parked for v2.1+.


## Open research / decisions before shipping

### 1. Hermes-agent feature gate (Honcho / agentskills.io / interrupt+redirect)
Tonight's investigation produces a yes/no/defer decision per candidate. See Scope section F. Three candidates surfaced from Apr 28 research; final v2.0 inclusion pending the deeper dive. Trello card on Plans/Today bucket tracks the investigation task.

### 2. Voice transcription provider
Currently bridge uses OpenAI cloud Whisper (whisper-1). Need a comparison study before v2.0 to decide what to default to, and what to offer:

- **OpenAI Whisper API** (current) — paid, network-dependent, decent quality
- **Local whisper.cpp** — free, private, fast on Apple Silicon, ~1GB model
- **faster-whisper** (CTranslate2) — local, often 2-4x faster than vanilla
- **distil-whisper** — smaller/faster, slight quality trade-off
- **Groq Whisper API** — much faster than OpenAI, cheaper
- **Deepgram / AssemblyAI** — managed alternatives, real-time streaming
- **gpt-4o-transcribe** — newer multimodal option

Deliverable: `docs/voice-transcription-research.md` comparing latency, cost per minute, quality (WER), install effort, supported languages, privacy story. Recommendation: which to ship as default + which to expose as user choice in Connections tab.

### 3. Google Workspace OAuth client
- **Option A:** ship a NativeClaw-owned shared OAuth client; users authenticate against it. Lower friction, but Jamiah owns the audit trail and verification status.
- **Option B:** users create their own GCP project + OAuth client. Higher friction, full user ownership.

Decide before shipping the Connections tab. v2.0 likely ships with B and adds A later if user demand justifies.

### 4. Settings server lifetime + auth
- **Lifetime:** on-demand only (`nativeclaw settings` starts it; auto-shutdown after 30 min idle). No always-on daemon.
- **Auth:** random URL token in initial browser launch URL (not guessable by other local processes). Revoked when server shuts down.
- **Multi-user shared machines:** bind to user's loopback only, document the token model.

---

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| OAuth tab interactions break wizard session | Explicit handoff convention with "click Continue when you're back" UX |
| Prereq install fails (Homebrew missing, npm permissions) | Surface actual error, link to docs, allow retry, never lock the wizard |
| User closes wizard mid-setup | Server detects partial state in workspace files, resumes from last completed step |
| Localhost port already in use | Auto-pick next available port (9292, 9293, etc.) |
| Multi-user shared machine | Random URL token in browser launch URL; never expose to non-loopback |
| Server stays running, eats RAM | Auto-shutdown after idle timeout (30 min default, configurable) |
| Windows port harder than scoped | Phase Windows separately if needed; ship Mac/Linux v2.0 first if Windows blocks the timeline |
| Backup contains secrets | Default-exclude `.mcp.json` and `bridge/config.json`; let user opt in to include |
| Diagnostic dump leaks secrets | Sanitize state.json, never include `.mcp.json`; redact bot tokens in log tail |

---

## Test plan

### Primary test user
**David** (Jamiah's best friend, non-developer). Test scenarios:
1. Fresh install on his laptop with zero terminal experience. Does he reach a working bot in under 15 minutes?
2. First config edit (change agent name, tweak a cron). Does he do it in settings UI without help?
3. Backup, fresh install on a different machine, restore. Does it work end-to-end?
4. Something breaks. Does the diagnostic dump tell Jamiah what is wrong?

### Power-user smoke
**Whet (Jamiah's primary install)** — confirm `setup.sh` path still works for upgrading from v1.10.x to v2.0. Confirm settings UI doesn't break existing workspace customizations.

### Cross-platform validation
- Mac: Whet (M2 MacBook) — primary
- Linux: Mark (Omarchy / Tailscale) — secondary
- Windows: TBD — Jamiah to acquire access to a Windows machine, or borrow one for testing

---

## Implementation phases

The release is shipped as one big v2.0, but development happens in phases for sanity:

| Phase | Scope | Estimate |
|-------|-------|----------|
| 1 | Setup wizard server skeleton + 6-page happy path (Mac/Linux) | 1 wk |
| 2 | Error handling, retry/skip/manual, OAuth handoff convention | 3 days |
| 3 | Settings UI control panel — Status, Config, MCP, Cron tabs | 1 wk |
| 4 | Settings UI — Connections, Logs, Backup/Restore tabs | 4 days |
| 5 | Voice transcription research, recommendation, integration | 3 days |
| 6 | Windows port (install.ps1, Task Scheduler, DPAPI keychain shim) | 1-2 wks |
| 7 | David UX test, iterate on findings | 3-5 days |
| 8 | Docs, screenshots, screencast, README rewrite, v2.0 tag + release | 3 days |

**Realistic total:** 4-6 weeks of focused work. Could compress with parallel tracks.

---

## Migration path from v1.10.x

Existing installs upgrade via the v1.10.4 agent-driven flow (`check for updates` triggers it). The agent:
1. Detects v2.0 is available.
2. Walks user through changelog.
3. Existing `setup.sh`-based config files are preserved as-is.
4. Settings UI becomes available via `nativeclaw settings` (new CLI command).
5. User-content files (`SOUL.md`, `MEMORY.md`, etc.) are never touched.
6. VERSION file bumped to `v2.0.0`.

Power users who want nothing to change can ignore the wizard and settings UI entirely. They keep editing JSON like before.

---

## Success criteria

- [ ] David completes fresh install end-to-end without help in under 15 minutes
- [ ] David edits at least one config field via settings UI without touching JSON
- [ ] Backup/restore round-trip works on a different machine
- [ ] Diagnostic dump produces a usable bundle Jamiah can debug from
- [ ] All v1.10.x functionality preserved (existing `setup.sh` path still works)
- [ ] Cross-platform: confirmed working on Mac, Linux, Windows
- [ ] Voice transcription recommendation made, default chosen, alternatives surfaced
- [ ] Public README + screencast updated to show the wizard

---

## What happens next (immediate)

1. Park this plan as the source of truth for v2.0.
2. Resume normal v1.10.x maintenance. Bug fixes and small features go to v1.10.5+.
3. When ready to start v2.0, kick off Phase 1 with the wizard skeleton.
4. Voice transcription research can happen in parallel — it is a research item, not a code item.
