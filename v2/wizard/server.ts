import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { NativeClawSetup } from './setup-core';

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const PORT = 9292;
const HOST = '127.0.0.1';

/**
 * Web-facing setup wizard server.
 * Same underlying setup-core.ts as the terminal TUI, but with HTML/JSON routes.
 */
export class WizardServer {
  private setup: NativeClawSetup;
  private server: http.Server | null = null;

  constructor() {
    this.setup = new NativeClawSetup();
  }

  start(port = PORT) {
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = u.pathname;
      const query = Object.fromEntries(u.searchParams);
      this.handleRoute(req, res, pathname, query);
    });
    this.server.listen(port, HOST, () => {
      console.log(`Wizard server: http://${HOST}:${port}`);
    });
    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} in use, trying ${port + 1}`);
        this.start(port + 1);
      }
    });
  }

  private async handleRoute(req: any, res: any, pathname: string, query: any) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      if (pathname === '/' || pathname === '/wizard') return this.serveWizardHTML(res);
      if (pathname === '/api/prereq-stream') return this.streamPrereq(res);
      if (pathname === '/api/validate-token') return this.handleValidateToken(res, query);
      if (pathname === '/api/poll-chat-id')   return this.handlePollChatId(res, query);
      if (pathname === '/api/install-stream') return this.streamInstall(req, res);
      if (pathname === '/api/save-step')      return this.handleSaveStep(req, res, query);
      if (pathname === '/api/test-xai-key')   return this.handleTestXaiKey(res, query);
      res.writeHead(404); res.end('Not found');
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  private serveWizardHTML(res: any) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>NativeClaw Setup</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1117;color:#e6e6e6;margin:0;line-height:1.5}
  .container{max-width:680px;margin:40px auto;padding:0 20px}
  h1{color:#00d4ff;font-size:28px;margin-bottom:6px}
  h2{font-size:20px;margin-bottom:12px}
  .progress{color:#8b949e;font-size:12px;margin-bottom:18px}
  .step{display:none;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:24px}
  .step.active{display:block}
  label{display:block;margin-bottom:6px;font-size:13px;color:#8b949e}
  input,select,textarea{width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;color:#e6e6e6;font-size:14px;margin-bottom:14px}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#00d4ff}
  textarea{font-family:ui-monospace,monospace;min-height:80px}
  .btn{background:#00d4ff;color:#0f1117;border:none;border-radius:6px;padding:10px 18px;font-weight:700;cursor:pointer;font-size:14px}
  .btn.secondary{background:#21262d;color:#c9d1d9}
  .btn.danger{background:#f85149;color:#fff}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn-row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
  .error{color:#f85149;font-size:13px;margin-top:4px}
  .success{color:#3fb950;font-size:13px}
  .help{color:#8b949e;font-size:13px;margin-bottom:10px}
  .help a{color:#58a6ff}
  pre{background:#0d1117;padding:12px;border-radius:6px;font-size:12px;max-height:240px;overflow:auto;font-family:ui-monospace,monospace;white-space:pre-wrap}
  .recovery{margin-top:14px;padding-top:14px;border-top:1px solid #30363d;font-size:12px;color:#8b949e}
  .recovery a{color:#58a6ff;margin-right:14px;cursor:pointer}
  .checkbox-row{margin-bottom:10px}
  .checkbox-row input{width:auto;margin-right:8px;margin-bottom:0}
  .checkbox-row label{display:inline;font-size:14px;color:#e6e6e6}
  code{background:#0d1117;padding:2px 6px;border-radius:4px;font-size:12px}
</style>
</head>
<body>
<div class="container">
  <h1>⚡ NativeClaw v2.0</h1>
  <div class="progress" id="progress">Step 1 of 9</div>

  <!-- 1. WELCOME -->
  <div class="step active" data-step="welcome">
    <h2>Welcome</h2>
    <p>This wizard sets up your AI agent to run via Telegram.</p>
    <p style="margin-top:10px">You'll need: a Telegram bot token (free from <a href="https://t.me/BotFather" target="_blank">@BotFather</a>), and either a Claude or Codex CLI installed. About 5-10 minutes.</p>
    <div class="btn-row"><button class="btn" onclick="next()">Start →</button></div>
  </div>

  <!-- 2. PREREQ CHECK -->
  <div class="step" data-step="prereq">
    <h2>Prerequisite Check</h2>
    <p class="help">Verifying Node.js and CLI tools…</p>
    <pre id="prereq-log">Checking…</pre>
    <div class="btn-row">
      <button class="btn secondary" onclick="prev()">Back</button>
      <button class="btn secondary" onclick="runPrereq()" id="prereq-retry">Re-run check</button>
      <button class="btn" onclick="next()" id="prereq-next">Continue →</button>
    </div>
    <div class="recovery">
      <a onclick="next()">Skip for now</a>
      <a href="https://nodejs.org" target="_blank">Install Node.js</a>
      <a href="https://docs.anthropic.com/en/docs/claude-code/quickstart" target="_blank">Install Claude CLI</a>
    </div>
  </div>

  <!-- 3. BACKEND -->
  <div class="step" data-step="backend">
    <h2>Backend Choice</h2>
    <p class="help">Which AI backends do you want? You can change this later in Settings → Config.</p>
    <select id="backend">
      <option value="both">Claude + Codex (recommended)</option>
      <option value="claude">Claude only — flat-rate via Claude Max</option>
      <option value="codex">Codex (OpenAI) only</option>
      <option value="openrouter">OpenRouter profiles (Kimi, MiniMax, Grok, etc.)</option>
    </select>
    <div class="btn-row">
      <button class="btn secondary" onclick="prev()">Back</button>
      <button class="btn" onclick="next()">Continue →</button>
    </div>
  </div>

  <!-- 4. IDENTITY -->
  <div class="step" data-step="identity">
    <h2>Agent Identity</h2>
    <label>Agent name</label><input id="agentName" value="Whet" />
    <label>Your name</label><input id="userName" value="" placeholder="What should the agent call you?" />
    <label>Vibe</label>
    <select id="vibe">
      <option value="sharp">Sharp — direct, no filler, opinions ok</option>
      <option value="friendly">Friendly — warm, collaborative</option>
      <option value="professional">Professional — formal, detailed</option>
      <option value="custom">Custom (edit SOUL.md after install)</option>
    </select>
    <div class="btn-row">
      <button class="btn secondary" onclick="prev()">Back</button>
      <button class="btn" onclick="next()">Continue →</button>
    </div>
  </div>

  <!-- 5. TELEGRAM -->
  <div class="step" data-step="telegram">
    <h2>Telegram Connection</h2>
    <label>Bot token (from @BotFather)</label>
    <input id="botToken" type="password" placeholder="123456:ABC-DEF..." />
    <div id="token-status"></div>
    <div class="help">After token validates, send any message to your bot. We auto-detect your chat ID.</div>
    <div id="chatid-status"></div>
    <div class="btn-row">
      <button class="btn secondary" onclick="prev()">Back</button>
      <button class="btn" onclick="validateToken()" id="validate-btn">Validate Token</button>
      <button class="btn" onclick="next()" id="tg-next" style="display:none">Continue →</button>
    </div>
    <div class="recovery">
      <a onclick="next()">Skip — I'll add this later in Settings</a>
      <a href="https://t.me/BotFather" target="_blank">Open @BotFather</a>
    </div>
  </div>

  <!-- 6. VOICE (xAI key) -->
  <div class="step" data-step="voice">
    <h2>Voice Transcription (Optional)</h2>
    <p class="help">Want to send voice messages to your bot and have them transcribed? Default provider is <strong>xAI Grok STT</strong> — fastest and cheapest.</p>
    <p class="help">Get a free key at <a href="https://console.x.ai" target="_blank">console.x.ai</a> (top up $5, lasts ~50 hours of audio).</p>
    <label>xAI API key (optional, leave blank to skip voice)</label>
    <input id="xaiKey" type="password" placeholder="xai-..." />
    <div id="xai-status"></div>
    <div class="btn-row">
      <button class="btn secondary" onclick="prev()">Back</button>
      <button class="btn" onclick="testXaiKey()" id="test-xai-btn">Test Key</button>
      <button class="btn secondary" onclick="next()">Skip Voice</button>
      <button class="btn" onclick="next()" id="voice-next" style="display:none">Continue →</button>
    </div>
  </div>

  <!-- 7. GOOGLE WORKSPACE (Option B) -->
  <div class="step" data-step="google">
    <h2>Google Workspace (Optional)</h2>
    <p class="help">Want your agent to read/write Google Drive, Calendar, Docs? You'll create your own OAuth client (~10 minutes, walked-through below). Skip if you don't need this.</p>
    <details style="margin-bottom:14px;background:#0d1117;padding:12px;border-radius:6px">
      <summary style="cursor:pointer;color:#58a6ff">Step-by-step setup guide</summary>
      <ol style="margin:12px 0 0 20px;line-height:1.7;font-size:13px">
        <li>Go to <a href="https://console.cloud.google.com/projectcreate" target="_blank">console.cloud.google.com</a> → New Project (any name).</li>
        <li>APIs &amp; Services → Library → enable Drive, Sheets, Docs, Calendar (only what you need).</li>
        <li>OAuth consent screen → External, add your email as a test user.</li>
        <li>Credentials → Create Credentials → OAuth client ID → Desktop App → name it.</li>
        <li>Click Download JSON → save as <code>~/.config/nativeclaw/google-credentials.json</code>.</li>
        <li>Paste path below.</li>
      </ol>
    </details>
    <label>Path to credentials.json</label>
    <input id="googleCredsPath" placeholder="~/.config/nativeclaw/google-credentials.json (leave blank to skip)" />
    <div class="btn-row">
      <button class="btn secondary" onclick="prev()">Back</button>
      <button class="btn secondary" onclick="next()">Skip Google</button>
      <button class="btn" onclick="next()">Continue →</button>
    </div>
  </div>

  <!-- 8. INSTALL -->
  <div class="step" data-step="install">
    <h2>Install</h2>
    <p class="help">Writes config, registers the bridge as a system service, starts it, sends a test message.</p>
    <pre id="install-log">Ready when you are.</pre>
    <div class="btn-row">
      <button class="btn secondary" onclick="prev()">Back</button>
      <button class="btn" onclick="runInstall()" id="install-btn">Install Now</button>
      <button class="btn" onclick="next()" id="install-next" style="display:none">Continue →</button>
    </div>
    <div class="recovery">
      <a onclick="runInstall()">Retry install</a>
      <a href="#" onclick="navigator.clipboard.writeText(document.getElementById('install-log').textContent);return false">Copy log</a>
    </div>
  </div>

  <!-- 9. DONE -->
  <div class="step" data-step="done">
    <h2>✅ Setup Complete</h2>
    <p>Your bridge is running. Send a message to your bot on Telegram to talk to your agent.</p>
    <p style="margin-top:14px">Useful commands:</p>
    <ul style="margin:10px 0 0 20px;line-height:1.7;font-size:13px">
      <li><code>nativeclaw status</code> — verify the bridge is alive</li>
      <li><code>nativeclaw settings</code> — open the settings UI in your browser</li>
      <li><code>nativeclaw logs</code> — tail the bridge log</li>
      <li><code>nativeclaw backup</code> — create a workspace backup</li>
    </ul>
  </div>
</div>

<script>
const STEPS = ['welcome','prereq','backend','identity','telegram','voice','google','install','done'];
let current = 0;
const state = {};

function show(i) {
  document.querySelectorAll('.step').forEach((s, idx) => s.classList.toggle('active', idx === i));
  document.getElementById('progress').textContent = 'Step ' + (i+1) + ' of ' + STEPS.length;
  current = i;
  if (STEPS[i] === 'prereq') runPrereq();
}
function next() { if (current < STEPS.length - 1) show(current + 1); }
function prev() { if (current > 0) show(current - 1); }

async function runPrereq() {
  const log = document.getElementById('prereq-log');
  log.textContent = '';
  document.getElementById('prereq-next').disabled = true;
  document.getElementById('prereq-retry').disabled = true;
  try {
    const resp = await fetch('/api/prereq-stream');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\\n\\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '__DONE__') {
            document.getElementById('prereq-next').disabled = false;
          } else {
            log.textContent += data + '\\n';
            log.scrollTop = log.scrollHeight;
          }
        }
      }
    }
  } catch (e) {
    log.textContent += 'Stream error: ' + e.message + '\\n';
  } finally {
    document.getElementById('prereq-retry').disabled = false;
    document.getElementById('prereq-next').disabled = false;
  }
}

async function validateToken() {
  const t = document.getElementById('botToken').value.trim();
  const status = document.getElementById('token-status');
  status.className = 'help';
  status.textContent = 'Validating…';
  try {
    const r = await fetch('/api/validate-token?token=' + encodeURIComponent(t));
    const j = await r.json();
    if (j.ok) {
      status.className = 'success';
      status.textContent = '✓ Token valid. Bot: @' + j.username;
      state.botToken = t;
      pollChatId(t);
    } else {
      status.className = 'error';
      status.textContent = j.error || 'Invalid token';
    }
  } catch (e) {
    status.className = 'error';
    status.textContent = 'Network error: ' + e.message;
  }
}

async function pollChatId(token) {
  const status = document.getElementById('chatid-status');
  status.className = 'help';
  status.innerHTML = 'Now <strong>send any message</strong> to your bot. Polling for chat ID…';
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('/api/poll-chat-id?token=' + encodeURIComponent(token));
      const j = await r.json();
      if (j.ok && j.chatId) {
        status.className = 'success';
        status.textContent = '✓ Chat ID detected: ' + j.chatId;
        state.allowedChatIds = [j.chatId];
        document.getElementById('tg-next').style.display = 'inline-block';
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  status.className = 'error';
  status.textContent = 'Timed out waiting for a message. You can continue and add chat ID later in Settings → Connections.';
  document.getElementById('tg-next').style.display = 'inline-block';
}

async function testXaiKey() {
  const k = document.getElementById('xaiKey').value.trim();
  const status = document.getElementById('xai-status');
  if (!k) { status.className = 'help'; status.textContent = 'No key entered — skipping.'; return; }
  status.className = 'help'; status.textContent = 'Testing…';
  try {
    const r = await fetch('/api/test-xai-key?key=' + encodeURIComponent(k));
    const j = await r.json();
    if (j.ok) {
      status.className = 'success';
      status.textContent = '✓ xAI key works.';
      state.xaiKey = k;
      document.getElementById('voice-next').style.display = 'inline-block';
    } else {
      status.className = 'error';
      status.textContent = j.error || 'Key rejected by xAI.';
    }
  } catch (e) {
    status.className = 'error';
    status.textContent = e.message;
  }
}

async function runInstall() {
  document.getElementById('install-btn').disabled = true;
  const log = document.getElementById('install-log');
  log.textContent = '';
  // gather state from forms (in case user navigated back/forward)
  state.backend = document.getElementById('backend').value;
  state.agentName = document.getElementById('agentName').value;
  state.userName = document.getElementById('userName').value;
  state.vibe = document.getElementById('vibe').value;
  state.botToken = state.botToken || document.getElementById('botToken').value;
  state.xaiKey = state.xaiKey || document.getElementById('xaiKey').value;
  state.googleCredsPath = document.getElementById('googleCredsPath').value;
  try {
    const resp = await fetch('/api/install-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let success = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\\n\\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '__DONE__') { success = true; }
          else if (data === '__FAIL__') { success = false; }
          else { log.textContent += data + '\\n'; log.scrollTop = log.scrollHeight; }
        }
      }
    }
    if (success) {
      document.getElementById('install-next').style.display = 'inline-block';
    } else {
      log.textContent += '\\n[ Install reported errors. See log above. ]\\n';
    }
  } catch (e) {
    log.textContent += '\\nStream error: ' + e.message;
  } finally {
    document.getElementById('install-btn').disabled = false;
  }
}

show(0);
</script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private writeSSE(res: any, data: string) {
    res.write(`data: ${data.replace(/\n/g, '\\n')}\n\n`);
  }

  private streamPrereq(res: any) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const checks = [
      { cmd: 'node', args: ['-v'], label: 'Node.js' },
      { cmd: 'claude', args: ['--version'], label: 'Claude CLI' },
      { cmd: 'codex', args: ['--version'], label: 'Codex CLI' },
      { cmd: 'opencode', args: ['--version'], label: 'OpenCode (for OpenRouter profiles)' },
    ];
    let i = 0;
    const next = () => {
      if (i >= checks.length) {
        this.writeSSE(res, '✓ Prerequisite check complete.');
        this.writeSSE(res, '__DONE__');
        return res.end();
      }
      const c = checks[i++];
      execFile(c.cmd, c.args, { timeout: 5000 }, (err, stdout) => {
        if (err) this.writeSSE(res, `✗ ${c.label} not found (optional)`);
        else this.writeSSE(res, `✓ ${c.label}: ${stdout.trim()}`);
        next();
      });
    };
    next();
  }

  private async streamInstall(req: any, res: any) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    let body = '';
    for await (const chunk of req) body += chunk;
    let data: any = {};
    try { data = body ? JSON.parse(body) : {}; } catch (e: any) {
      this.writeSSE(res, 'JSON parse error: ' + e.message);
      this.writeSSE(res, '__FAIL__');
      return res.end();
    }

    try {
      this.writeSSE(res, '→ Writing config…');
      this.setup.loadState({
        backend: data.backend,
        agentName: data.agentName,
        userName: data.userName,
        vibeTemplate: data.vibe,
        botToken: data.botToken,
        allowedChatIds: data.allowedChatIds,
        enableQMD: true,
        enableVoice: !!data.xaiKey,
        xaiKey: data.xaiKey,
        googleCredsPath: data.googleCredsPath,
      } as any);
      this.writeSSE(res, '✓ Config saved to ~/.claude/telegram-bridge/config.json');

      if (data.xaiKey) {
        this.writeSSE(res, '→ Storing xAI key in keychain…');
        await this.storeKeychain('XAI_API_KEY', data.xaiKey);
        this.writeSSE(res, '✓ xAI key stored');
      }

      this.writeSSE(res, '→ Registering bridge as system service…');
      this.setup.stepInstall();
      this.writeSSE(res, '✓ Service registered.');
      this.writeSSE(res, '✓ Setup complete. Send a message to your bot on Telegram.');
      this.writeSSE(res, '__DONE__');
    } catch (e: any) {
      this.writeSSE(res, '✗ Install failed: ' + e.message);
      this.writeSSE(res, '__FAIL__');
    }
    res.end();
  }

  private storeKeychain(service: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'darwin') return resolve(); // skip on non-mac for now
      execFile('/usr/bin/security', [
        'add-generic-password', '-a', 'whet', '-s', service, '-w', value, '-U',
      ], (err) => err ? reject(err) : resolve());
    });
  }

  private async handleSaveStep(req: any, res: any, query: any) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    this.setup.loadState(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }

  private async handleValidateToken(res: any, query: any) {
    const token = query.token || '';
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const j = await r.json() as any;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (j.ok) res.end(JSON.stringify({ ok: true, username: j.result.username }));
      else res.end(JSON.stringify({ ok: false, error: j.description || 'Invalid token' }));
    } catch (e: any) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  private async handlePollChatId(res: any, query: any) {
    const token = query.token || '';
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
      const j = await r.json() as any;
      const last = j.ok && j.result.length > 0 ? j.result[j.result.length - 1] : null;
      const chatId = last?.message?.chat?.id || null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, chatId }));
    } catch (e: any) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  private async handleTestXaiKey(res: any, query: any) {
    const key = query.key || '';
    if (!key) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'No key' }));
    }
    try {
      const r = await fetch('https://api.x.ai/v1/models', {
        headers: { 'Authorization': 'Bearer ' + key },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (r.ok) res.end(JSON.stringify({ ok: true }));
      else res.end(JSON.stringify({ ok: false, error: 'xAI rejected key (HTTP ' + r.status + ')' }));
    } catch (e: any) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }
}

export default WizardServer;
