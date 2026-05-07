# NativeClaw v2.0 — David UX Test Plan

**Test user:** David (Jamiah's best friend, non-developer)
**Goal:** David completes a fresh install end-to-end without help in under 15 minutes.

---

## Scenarios

### Scenario 1: Fresh Install (Terminal mode)
**Setup:** Unzip a clean macOS VM / fresh user account with no prior NativeClaw or AI CLI installed.
**Steps:**
1. Run `curl -fsSL https://install.nativeclaw.dev | bash`
2. Follow the terminal setup wizard prompts
3. Verify nativeclaw is on PATH: `which nativeclaw`
4. Run `nativeclaw status` and get "Bridge Alive"

**Pass criteria:** Reaches working bot within 15 minutes. Fails at any step = friction point.

---

### Scenario 2: Config Edit (No JSON touching)
**Setup:** After Scenario 1 completes.
**Steps:**
1. Run `nativeclaw settings`
2. Change agent name from default to a custom name
3. Save and verify new name appears in next Telegram message from the bot

**Pass criteria:** Edits a field in the web UI without opening a code editor.

---

### Scenario 3: Backup + Restore on a Different Machine
**Setup:** After Scenario 1, take a backup.
**Steps:**
1. Run `nativeclaw backup`
2. Verify the `.zip` file is created in `~/.claude/backups/`
3. Move to a second machine (different Mac / VM)
4. Install NativeClaw fresh
5. Run `nativeclaw restore` with the backup zip
6. Verify agent name and settings from Scenario 2 persisted

**Pass criteria:** Round-trip backup/restore succeeds, settings retained.

---

### Scenario 4: Something Breaks → Diagnostic Dump
**Setup:** Purposely break one MCP config (rename `~/.claude/.mcp.json` to `.mcp.json.bak`).
**Steps:**
1. David notices Telegram messages stop or an error appears
2. Run `nativeclaw doctor`
3. Attach the generated `.zip` to a message to Jamiah

**Pass criteria:** David can produce a diagnostic bundle without needing shell debugging skills.

---

### Scenario 5: Settings UI Port Conflict
**Setup:** Something else is already on port 9292 (e.g., `python -m http.server 9292`).
**Steps:**
1. Run `nativeclaw settings`
2. Verify it auto-picks port 9293 and prints the correct URL
3. Browser opens to the new URL

**Pass criteria:** Port conflict is handled silently, no manual port selection required.

---

## Ratings

| Score | Meaning |
|-------|---------|
| 🟢 Green | Completed without help; went smoothly |
| 🟡 Yellow | Completed with light hints ("Try hitting Enter at that prompt") |
| 🔴 Red | Could not complete without Jamiah taking over |

---

## Timeline

- **Pre-test:** David given a fresh MacBook / VM login
- **Duration target:** 15 minutes total for Scenarios 1–2
- **Post-test:** 5-minute debrief (what was confusing, what broke)

---

## Known Risks

| Risk | Mitigation |
|------|------------|
| David doesn't have Node.js | Install script detects and prompts install |
| Don't have Claude/Codex API keys | OAuth handoff in wizard handles this |
| Bot token is confusing | Wizard validates regex and wizard explains @BotFather step |
