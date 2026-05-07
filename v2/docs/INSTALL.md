# NativeClaw v2.0 — Installation Guide

## Prerequisites

- **Node.js 18+** — verify with `node -v`
- **Git** — for cloning
- **One of the following AI backends:**
  - Claude CLI (via Anthropic)
  - Codex CLI (via OpenAI)
  - OpenCode CLI (for Kimi/Grok via OpenRouter)
- **Telegram bot token** — from @BotFather
- **macOS / Linux / Windows**

---

## One-Command Install (macOS / Linux)

```bash
curl -fsSL https://install.nativeclaw.dev | bash
```

This will:
1. Check Node.js, Git, and AI CLIs
2. Clone the repo into `~/.nativeclaw`
3. Install dependencies
4. Build TypeScript to `dist/`
5. Symlink `nativeclaw` to `~/.local/bin/`

Then run the setup wizard:

```bash
nativeclaw setup
```

---

## Windows Install

In PowerShell:

```powershell
iwr -useb https://install.nativeclaw.dev/install.ps1 | iex
```

The installer will:
1. Detect or install Node.js via winget
2. Clone the repo into `%USERPROFILE%\.nativeclaw`
3. Build the project
4. Add `nativeclaw` to your PATH

After install, run the setup wizard:

```powershell
nativeclaw setup
```

---

## Manual Install

```bash
git clone https://github.com/njdev/nativeclaw.git ~/.nativeclaw
cd ~/.nativeclaw/v2
npm install
npm run build
```

Then add `~/.nativeclaw/v2/bin` to your `PATH`.

---

## Post-Install Verification

Run these commands to verify everything is working:

```bash
# Check the CLI dispatcher
nativeclaw --help

# Check bridge health
nativeclaw status

# Check that TypeScript compiles
npm run build

# Run smoke tests
npm run test

# Verify all files are present
npm run verify
```

---

## First-Time Setup

Run the setup wizard:

```bash
nativeclaw setup
```

It will ask for:
1. **Backend choice** — Claude / Codex / Kimi / Grok / multiple
2. **Agent identity** — name, user name, vibe template
3. **Telegram connection** — bot token + auto-detect chat ID
4. **Optional features** — QMD memory, voice transcription

---

## Service Registration

After setup, the bridge needs to run as a background service.

### macOS (launchd)

The setup wizard writes a `.plist` to `~/Library/LaunchAgents/`. Load it:

```bash
launchctl load -w ~/Library/LaunchAgents/com.njdev.nativeclaw.plist
```

### Linux (systemd)

Install the service file:

```bash
cp ~/.nativeclaw/v2/systemd/nativeclaw.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable nativeclaw
systemctl --user start nativeclaw
```

### Windows (Task Scheduler)

Import the XML and start the task:

```powershell
schtasks /Create /XML ~/.nativeclaw/v2/windows/nativeclaw-task.xml /TN "NativeClaw" /F
schtasks /Run /TN "NativeClaw"
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `nativeclaw: command not found` | Ensure `~/.local/bin` (macOS/Linux) or the equivalent is on your PATH |
| `tsc: not found` | Run `npm install` again; check that `typescript` is in `node_modules/.bin` |
| Bridge not starting | Run `nativeclaw status` to see errors; check `~/.claude/logs/telegram-bridge.log` |
| Kimi/Grok crons running on Claude | Ensure `~/.claude/telegram-bridge/bridge.js` has the cron fix from v2.0. Run `npm run build` |
| Settings UI 404 | Check token in URL matches the server's generated token |
| Windows certificate issues | Make sure `cmdkey` or Credential Manager is available |

---

## Next Steps

- Read the [README](../README.md) for feature overview
- Read the [CHANGELOG](../CHANGELOG.md) for version history
- Run `nativeclaw settings` to tweak config without editing JSON
- Run `nativeclaw doctor` if something breaks and you need support
