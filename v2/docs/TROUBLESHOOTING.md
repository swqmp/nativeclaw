# NativeClaw v2.0 — Troubleshooting

## Quick Status Check

```bash
nativeclaw status
```

If the bridge is down, restart with the method for your OS:

- **macOS:** `launchctl kickstart -k gui/501/com.njdev.claude-session`
- **Linux:** `systemctl --user restart nativeclaw`
- **Windows:** `schtasks /Run /TN NativeClaw`

---

## Common Issues

### 1. Kimi/Grok crons silently falling through to Claude

**Symptom:** Bridge log shows crons like `Cron heartbeat completed: $0.20, 5 turns` but without `[kimi]` / `[grok]` bracketed backend in the log line.

**Fix:** Ensure `~/.claude/telegram-bridge/bridge.js` has the cron routing fix from v2.0. Look for:
```js
} else if (cronBackend === 'kimi' || cronBackend === 'grok') {
  ... runOpenCode(...)
```

### 2. OpenCode permission errors

**Symptom:** Model starts working then immediately disconnects after a tool call. Log shows `permission=external_directory asking` then session disposal.

**Fix:** Add this block to `~/.config/opencode/opencode.json`:
```json
"permission": {
  "external_directory": {
    "/Users/<username>/*": "allow",
    "/tmp/*": "allow"
  }
}
```

### 3. Settings UI says "Forbidden: invalid or missing token"

**Symptom:** Browser opened to `127.0.0.1:9292` but shows a 403 error.

**Fix:** The token is in the URL query string. If you manually navigated without copying the full URL from the terminal output, re-run `nativeclaw settings` and click the full generated URL.

### 4. Diagnostic dump includes secrets

**Symptom:** `nativeclaw doctor` zip contains `.mcp.json`.

**Fix:** The doctor script already sanitizes `state.json` and skips `.mcp.json`. If you see secrets, report it as a bug — `doctor` must never package credentials.

### 5. Windows backup fails

**Symptom:** `nativeclaw backup` says `zip exited 127` on Windows.

**Fix:** Windows does not ship `zip` by default. Install 7-Zip or use PowerShell `Compress-Archive`.

### 6. Settings server doesn't open browser

**Symptom:** Terminal prints the URL but browser doesn't launch.

**Fix:** The server used `exec('open "..."')` (macOS) / `start "" "..."` (Windows) / `xdg-open "..."` (Linux). On headless systems or SSH, `xdg-open` may fail silently. Copy the URL and paste into a browser on the same machine.

### 7. TypeScript build fails

**Symptom:** `npm run build` emits `Cannot find module 'child_process'` errors.

**Fix:** Install types:
```bash
cd ~/.nativeclaw/v2
npm install --save-dev @types/node
npm run build
```

---

## Getting Help

1. Run `nativeclaw doctor` to generate a diagnostic bundle.
2. Attach the `.zip` to a message or email to jamiahbartlett@gmail.com.
3. Include the last 20 lines of `~/.claude/logs/telegram-bridge.log`.
