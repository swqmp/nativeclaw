#!/usr/bin/env node

// Telegram Bridge for Claude Code Native Setup
// Custom built — no external dependencies, Node.js built-in modules only
// Handles: Telegram message reception/response + cron job scheduling
// Version: 1.7.0
//
// Architecture:
//   Telegram polling → message queue → claude -p subprocess → response back to Telegram
//   Cron scheduler → cron queue → claude -p subprocess → output logged / sent to Telegram
//   Two concurrent workers (telegram + cron) so messages aren't blocked by long crons

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG & STATE
// ============================================================

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');
const PID_PATH = path.join(__dirname, 'bridge.pid');
const HOME_DIR = process.env.HOME || process.env.USERPROFILE;
const LOG_DIR = path.join(HOME_DIR, '.claude', 'logs');
const LOG_PATH = path.join(LOG_DIR, 'telegram-bridge.log');
const IMAGE_DIR = path.join(HOME_DIR, '.claude', 'telegram-images');

// Ensure log and image directories exist
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

// Load config
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error(`Failed to load config from ${CONFIG_PATH}: ${err.message}`);
  process.exit(1);
}

const BOT_TOKEN = config.botToken;
const CLAUDE_API_KEY = config.claudeApiKey;
const ALLOWED_CHAT_IDS = config.allowedChatIds.map(Number);
const WORKSPACE = config.workspace;
const CRON_WORKSPACE = path.join(config.workspace, 'cron-workspace');
const MCP_CONFIG = config.mcpConfig;
const CRON_SCHEDULE_PATH = config.cronSchedule;
const DEFAULT_MODEL = config.model || 'sonnet';
const OPENAI_API_KEY = config.openaiApiKey || '';

// Per-chat settings (model overrides, thinking, etc.)
let chatSettings = {};

// Load or initialize state
let state = { updateOffset: 0, sessions: {}, exchangeCount: {} };
if (fs.existsSync(STATE_PATH)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!state.exchangeCount) state.exchangeCount = {};
  } catch {
    // Corrupted state, start fresh
    state = { updateOffset: 0, sessions: {}, exchangeCount: {} };
  }
}

// Checkpoint enforcement: track exchanges per session
const CHECKPOINT_THRESHOLD = 8;
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

// Write PID file for restart script
fs.writeFileSync(PID_PATH, String(process.pid));

// ============================================================
// LOGGING
// ============================================================

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

// ============================================================
// TELEGRAM API
// ============================================================

const TG_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, params = {}) {
  // Long-poll getUpdates gets a longer timeout, everything else gets 15s
  const isLongPoll = method === 'getUpdates' && params.timeout;
  const timeoutMs = isLongPoll ? (params.timeout + 10) * 1000 : 15000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${TG_BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.description}`);
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

// Convert GitHub-flavored markdown to Telegram-compatible HTML
function mdToHtml(text) {
  const codeBlocks = [];
  const inlineCode = [];

  text = text.replace(/```\w*\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  text = text.replace(/`([^`]+)`/g, (_, code) => {
    inlineCode.push(code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    return `\x00IC${inlineCode.length - 1}\x00`;
  });

  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');
  text = text.replace(/\*(.+?)\*/g, '<i>$1</i>');
  text = text.replace(/_(.+?)_/g, '<i>$1</i>');
  text = text.replace(/^---+$/gm, '');
  text = text.replace(/^\|(.+)\|$/gm, (_, row) =>
    row.split('|').map(c => c.trim()).filter(Boolean).join('   ')
  );
  text = text.replace(/^[\s|:-]+$/gm, '');
  text = text.replace(/\x00IC(\d+)\x00/g, (_, i) => `<code>${inlineCode[i]}</code>`);
  text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => `<pre>${codeBlocks[i]}</pre>`);
  return text;
}

async function sendMessage(chatId, text) {
  const html = mdToHtml(text);
  const chunks = splitText(html, 4000);
  for (const chunk of chunks) {
    try {
      await tg('sendMessage', { chat_id: chatId, text: chunk, parse_mode: 'HTML' });
    } catch (err) {
      log(`HTML send failed, retrying plain: ${err.message}`);
      const plainChunks = splitText(text, 4000);
      for (const plain of plainChunks) {
        try {
          await tg('sendMessage', { chat_id: chatId, text: plain });
        } catch (retryErr) {
          log(`sendMessage retry failed: ${retryErr.message}`);
        }
      }
      break;
    }
  }
}

function splitText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen; // No good newline, hard split
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ============================================================
// TELEGRAM IMAGE DOWNLOAD
// ============================================================

async function downloadTelegramFile(fileId, prefix = 'file') {
  // Get file path from Telegram
  const fileInfo = await tg('getFile', { file_id: fileId });
  const filePath = fileInfo.file_path;
  const ext = path.extname(filePath) || '';
  const localName = `${prefix}_${Date.now()}${ext}`;
  const localPath = path.join(IMAGE_DIR, localName);

  // Download the file
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(localPath, buffer);

  log(`Downloaded Telegram file: ${localPath} (${buffer.length} bytes)`);
  return localPath;
}

async function transcribeVoice(audioPath) {
  if (!OPENAI_API_KEY) throw new Error('openaiApiKey not set in config.json');

  const audioBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer]), fileName);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Whisper API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.text || '').trim();
}

// ============================================================
// CLAUDE CODE SUBPROCESS
// ============================================================

// Track the currently running subprocess so /stop can kill it
let activeSubprocess = null;

function runClaude(prompt, sessionId, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--model', options.model || DEFAULT_MODEL,
    ];

    if (sessionId) {
      args.push('-r', sessionId);
    }

    if (MCP_CONFIG && fs.existsSync(MCP_CONFIG)) {
      args.push('--mcp-config', MCP_CONFIG);
    }

    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    if (options.thinking) {
      args.push('--max-thinking-tokens', '10000');
    }

    // Use lightweight cron workspace for cron jobs, full workspace for user messages
    const cwd = options.isCron ? CRON_WORKSPACE : WORKSPACE;

    log(`Spawning: claude ${args.slice(0, 6).join(' ')}... (cwd: ${options.isCron ? 'cron' : 'main'})`);

    // Strip only the "nested session" detection vars, keep session auth token
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.MCP_CLAUDE;

    const proc = spawn('claude', args, {
      cwd: cwd,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeSubprocess = proc;

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    // Timeout safety net
    const timeoutMs = (options.timeout || 300) * 1000;
    const timer = setTimeout(() => {
      log(`Claude subprocess timed out after ${timeoutMs}ms, killing...`);
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      activeSubprocess = null;
      clearTimeout(timer);

      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(stderr.trim() || `claude exited with code ${code}`));
      }

      try {
        // Try to find the result JSON object
        const lines = stdout.trim().split('\n');
        let result = null;

        // Search from the end for a result-type JSON
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed.type === 'result') {
              result = parsed;
              break;
            }
          } catch {
            // Not JSON, skip
          }
        }

        // Fallback: try parsing entire stdout as JSON
        if (!result) {
          try {
            result = JSON.parse(stdout);
          } catch {
            // Return raw text
            return resolve({ text: stdout.trim(), sessionId: null, cost: 0, turns: 0 });
          }
        }

        resolve({
          text: result.result || result.message || '',
          sessionId: result.session_id || null,
          cost: result.total_cost_usd || result.cost_usd || 0,
          turns: result.num_turns || 0,
          duration: result.duration_ms || 0,
          isError: result.is_error || false,
        });
      } catch (e) {
        resolve({ text: stdout.trim(), sessionId: null, cost: 0, turns: 0 });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

function runCodex(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const model = options.model || config.model || 'codex-mini-latest';
    const args = [
      '--approval-mode', 'full-auto',
      '-q',
      '--model', model,
      prompt,
    ];

    const cwd = options.isCron ? CRON_WORKSPACE : WORKSPACE;
    log(`Spawning: codex ${args.slice(0, 4).join(' ')}... (cwd: ${options.isCron ? 'cron' : 'main'})`);

    const proc = spawn('codex', args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeSubprocess = proc;
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeoutMs = (options.timeout || 300) * 1000;
    const timer = setTimeout(() => {
      log(`Codex subprocess timed out after ${timeoutMs}ms, killing...`);
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      activeSubprocess = null;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(stderr.trim() || `codex exited with code ${code}`));
      }
      resolve({ text: stdout.trim(), sessionId: null, cost: 0, turns: 0 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn codex: ${err.message}`));
    });
  });
}

function runLLM(prompt, sessionId, options = {}) {
  const provider = config.provider || 'claude';
  if (provider === 'codex') {
    return runCodex(prompt, options);
  }
  return runClaude(prompt, sessionId, options);
}

// ============================================================
// MESSAGE QUEUES & WORKERS
// ============================================================

const telegramQueue = [];
const cronQueue = [];
let processingTelegram = false;
let processingCron = false;

// Debounce: collect Telegram chunks before processing
const chatDebounceTimers = {};
const DEBOUNCE_MS = 1500;

function enqueueTelegram(item) {
  telegramQueue.push(item);

  // Start typing indicator immediately so it doesn't feel unresponsive during debounce
  tg('sendChatAction', { chat_id: item.chatId, action: 'typing' }).catch(() => {});

  // Reset debounce timer for this chat — wait until chunks stop arriving
  if (chatDebounceTimers[item.chatId]) {
    clearTimeout(chatDebounceTimers[item.chatId]);
  }
  chatDebounceTimers[item.chatId] = setTimeout(() => {
    delete chatDebounceTimers[item.chatId];
    processTelegramQueue();
  }, DEBOUNCE_MS);
}

function enqueueCron(item) {
  cronQueue.push(item);
  processCronQueue();
}

async function processTelegramQueue() {
  if (processingTelegram || telegramQueue.length === 0) return;
  processingTelegram = true;

  while (telegramQueue.length > 0) {
    const item = telegramQueue.shift();

    // Collapse consecutive messages from the same chat (Telegram splits long messages into chunks)
    while (telegramQueue.length > 0 && telegramQueue[0].chatId === item.chatId) {
      const next = telegramQueue.shift();
      item.text = item.text + '\n' + next.text;
      // Carry over attachments from subsequent chunks
      if (next._imagePath && !item._imagePath) {
        item._imagePath = next._imagePath;
      }
    }

    try {
      await handleTelegramMessage(item);
    } catch (err) {
      log(`ERROR handling Telegram message: ${err.message}`);
    }
  }

  processingTelegram = false;
}

async function processCronQueue() {
  if (processingCron || cronQueue.length === 0) return;
  processingCron = true;

  while (cronQueue.length > 0) {
    const item = cronQueue.shift();
    try {
      await handleCronJob(item);
    } catch (err) {
      log(`ERROR handling cron job: ${err.message}`);
    }
  }

  processingCron = false;
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const MODEL_ALIASES = {
  'opus': 'opus',
  'opus4.6': 'opus',
  'opus-4.6': 'opus',
  'sonnet': 'sonnet',
  'sonnet4.6': 'sonnet',
  'sonnet-4.6': 'sonnet',
  'sonnet4.5': 'claude-sonnet-4-5-20241022',
  'sonnet-4.5': 'claude-sonnet-4-5-20241022',
  'haiku': 'haiku',
  'haiku4.5': 'haiku',
  'haiku-4.5': 'haiku',
};

const CODEX_MODEL_ALIASES = {
  'mini': 'codex-mini-latest',
  'codex-mini': 'codex-mini-latest',
  'o4-mini': 'o4-mini',
  'o3': 'o3',
};

const MODEL_DISPLAY = {
  'opus': 'Opus 4.6',
  'sonnet': 'Sonnet 4.6',
  'claude-sonnet-4-5-20241022': 'Sonnet 4.5',
  'haiku': 'Haiku 4.5',
};

function getSettings(chatId) {
  if (!chatSettings[chatId]) {
    chatSettings[chatId] = { model: null, thinking: false, lastResult: null };
  }
  return chatSettings[chatId];
}

async function handleSlashCommand(chatId, text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');
  const settings = getSettings(chatId);
  const sessionKey = String(chatId);

  switch (cmd) {
    case '/model': {
      if (!arg) {
        const current = settings.model || DEFAULT_MODEL;
        const display = MODEL_DISPLAY[current] || current;
        return `Current model: ${display}`;
      }
      const isCodex = (config.provider || 'claude') === 'codex';
      const alias = isCodex
        ? (CODEX_MODEL_ALIASES[arg.toLowerCase()] || MODEL_ALIASES[arg.toLowerCase()])
        : MODEL_ALIASES[arg.toLowerCase()];
      if (!alias) {
        const aliasMap = isCodex ? CODEX_MODEL_ALIASES : MODEL_ALIASES;
        const available = Object.entries(aliasMap)
          .filter(([k, v], i, arr) => arr.findIndex(([k2, v2]) => v2 === v) === i)
          .map(([k, v]) => `  ${k} → ${MODEL_DISPLAY[v] || v}`)
          .join('\n');
        return `Unknown model "${arg}". Available:\n${available}`;
      }
      settings.model = alias;
      return `Switched to ${MODEL_DISPLAY[alias] || alias}`;
    }

    case '/opus':
      settings.model = 'opus';
      return 'Switched to Opus 4.6';

    case '/sonnet':
      settings.model = 'sonnet';
      return 'Switched to Sonnet 4.6';

    case '/haiku':
      settings.model = 'haiku';
      return 'Switched to Haiku 4.5';

    case '/think':
    case '/thinking': {
      if (arg === 'off') {
        settings.thinking = false;
        return 'Extended thinking: OFF';
      }
      settings.thinking = !settings.thinking;
      return `Extended thinking: ${settings.thinking ? 'ON' : 'OFF'}`;
    }

    case '/reset':
    case '/new':
      delete state.sessions[sessionKey];
      delete state.exchangeCount[sessionKey];
      saveState();
      return 'Session cleared. Next message starts a fresh conversation.';

    case '/stats': {
      const last = settings.lastResult;
      if (!last) return 'No stats yet. Send a message first.';
      return [
        `Last response stats:`,
        `  Model: ${MODEL_DISPLAY[last.model] || last.model}`,
        `  Duration: ${(last.duration / 1000).toFixed(1)}s`,
        `  Turns: ${last.turns}`,
        `  Cost: $${last.cost}`,
        `  Session: ${last.sessionId || 'none'}`,
      ].join('\n');
    }

    case '/session': {
      const sid = state.sessions[sessionKey];
      return sid
        ? `Session ID: ${sid}\nUse /reset to start fresh.`
        : 'No active session. Next message will start one.';
    }

    case '/status': {
      const bridgePid = fs.existsSync(PID_PATH) ? fs.readFileSync(PID_PATH, 'utf8').trim() : '?';
      const cronCount = cronJobs.length;
      const current = settings.model || DEFAULT_MODEL;
      const thinking = settings.thinking ? 'ON' : 'OFF';
      const sid = state.sessions[sessionKey] ? 'Active' : 'None';
      return [
        'NativeClaw Status:',
        `  Bridge PID: ${bridgePid}`,
        `  Model: ${MODEL_DISPLAY[current] || current}`,
        `  Thinking: ${thinking}`,
        `  Session: ${sid}`,
        `  Cron jobs: ${cronCount}`,
        `  MCP config: ${MCP_CONFIG ? 'loaded' : 'none'}`,
      ].join('\n');
    }

    case '/search': {
      if (!arg) return 'Usage: /search <query>\nSearches memory using QMD semantic search.';
      // Pass to Claude with explicit search instruction
      return null; // null = not handled, pass to Claude
    }

    case '/help':
    case '/commands':
      return [
        'NativeClaw Commands:',
        '',
        '/model [name] — Show or switch model',
        '/opus — Switch to Opus 4.6',
        '/sonnet — Switch to Sonnet 4.6',
        '/model sonnet-4.5 — Switch to Sonnet 4.5',
        '/haiku — Switch to Haiku 4.5',
        '/think — Toggle extended thinking',
        '/reset — Clear session, start fresh',
        '/stats — Last response stats',
        '/session — Show session info',
        '/status — System status',
        '/stop — Kill current task and clear queue',
        '/restart — Restart the NativeClaw service',
        '/search <query> — Search memory (QMD)',
        '/help — This message',
      ].join('\n');

    default:
      return null; // Not a known command, pass to Claude
  }
}

// ============================================================
// TELEGRAM MESSAGE HANDLER
// ============================================================

async function handleTelegramMessage(item) {
  const { chatId, text, username, firstName, _imagePath } = item;
  const name = firstName || username || 'User';
  const sessionKey = String(chatId);
  const settings = getSettings(chatId);

  log(`Message from ${name} (${chatId}): ${text.slice(0, 150)}${text.length > 150 ? '...' : ''}`);

  // Handle slash commands
  if (text.startsWith('/')) {
    const response = await handleSlashCommand(chatId, text);
    if (response !== null) {
      await sendMessage(chatId, response);
      return;
    }
    // null = unknown command or /search, pass through to Claude
  }

  // Typing indicator — repeat every 4s since Telegram's indicator expires after 5s
  tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const typingInterval = setInterval(() => {
    tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  }, 4000);

  // Get existing session for this chat
  let sessionId = state.sessions[sessionKey] || null;

  // Increment exchange counter for this session
  if (!state.exchangeCount[sessionKey]) state.exchangeCount[sessionKey] = 0;
  state.exchangeCount[sessionKey]++;

  // Build prompt — for /search, wrap with QMD instruction
  let prompt = text;
  if (text.startsWith('/search ')) {
    prompt = `Search memory using the QMD search_memory tool for: ${text.slice(8)}. Return the results.`;
  }

  // Checkpoint enforcement: inject reminder after N exchanges without a checkpoint
  // Fires at 8, 16, 24, etc. — not every message after 8
  if (state.exchangeCount[sessionKey] >= CHECKPOINT_THRESHOLD && state.exchangeCount[sessionKey] % CHECKPOINT_THRESHOLD === 0) {
    const today = new Date().toISOString().slice(0, 10);
    const dailyLog = path.join(MEMORY_DIR, `${today}.md`);
    let needsCheckpoint = true;
    try {
      if (fs.existsSync(dailyLog)) {
        const logStat = fs.statSync(dailyLog);
        const minutesSinceWrite = (Date.now() - logStat.mtimeMs) / (1000 * 60);
        if (minutesSinceWrite < 5) needsCheckpoint = false; // Recently written
      }
    } catch {}
    if (needsCheckpoint) {
      prompt = `[SYSTEM REMINDER: You have exchanged ${state.exchangeCount[sessionKey]} messages without writing a checkpoint. Write to memory/${today}.md NOW using the Edit or Write tool (NOT bash cat/echo — those may be blocked). Include: what you did, decisions made, open questions, next actions, feedback logged. Then reindex memory if available.]\n\n${prompt}`;
      log(`Checkpoint reminder injected after ${state.exchangeCount[sessionKey]} exchanges`);
    } else {
      // Write succeeded recently — reset counter
      state.exchangeCount[sessionKey] = 0;
    }
    saveState();
  }

  // Determine model (per-chat override or default)
  const model = settings.model || DEFAULT_MODEL;

  try {
    const result = await runLLM(prompt, sessionId, {
      timeout: 14400,
      model: model,
      thinking: settings.thinking,
    });

    clearInterval(typingInterval);

    // Save stats for /stats command
    settings.lastResult = {
      model: model,
      duration: result.duration || 0,
      turns: result.turns,
      cost: result.cost,
      sessionId: result.sessionId,
    };

    // Save session ID for continuity
    if (result.sessionId) {
      state.sessions[sessionKey] = result.sessionId;
      saveState();
    }

    // Send response
    if (result.text) {
      await sendMessage(chatId, result.text);
      log(`Replied to ${name}: ${result.text.length} chars, ${result.turns} turns, $${result.cost}`);
    } else {
      await sendMessage(chatId, '(No response generated)');
      log(`Empty response for ${name}`);
    }

    // Clean up temp image file
    if (_imagePath) {
      try { fs.unlinkSync(_imagePath); } catch {}
    }
  } catch (err) {
    clearInterval(typingInterval);
    log(`ERROR responding to ${name}: ${err.message}`);
    await sendMessage(chatId, `Something went wrong: ${err.message.slice(0, 200)}`);

    // If session is broken, clear it so next message starts fresh
    if (err.message.includes('session') || err.message.includes('resume')) {
      delete state.sessions[sessionKey];
      saveState();
      log(`Cleared broken session for ${sessionKey}`);
    }

    // Clean up temp image file on error too
    if (_imagePath) {
      try { fs.unlinkSync(_imagePath); } catch {}
    }
  }
}

// ============================================================
// CRON HANDLER
// ============================================================

async function handleCronJob(item) {
  const { name, prompt, timeout, model } = item;

  log(`Cron firing: ${name}`);
  const startTime = Date.now();

  try {
    const result = await runLLM(prompt, null, {
      timeout: timeout || 300,
      model: model || DEFAULT_MODEL,
      maxTurns: 100,
      isCron: true,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Cron ${name} completed: ${duration}s, ${result.turns} turns, $${result.cost}`);

    // After session-audit completes, mechanically clear the session
    // Don't rely on the LLM to do this — it's unreliable
    if (name === 'session-audit') {
      for (const key of Object.keys(state.sessions)) {
        if (state.sessions[key]) {
          log(`Session-audit: clearing session ${state.sessions[key]} for chat ${key}`);
          state.sessions[key] = '';
          state.exchangeCount[key] = 0;
        }
      }
      saveState();
    }

    // Cron prompts handle their own Telegram delivery via telegram_direct.sh
    // So we don't need to send the output here
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Cron ${name} FAILED after ${duration}s: ${err.message}`);

    // Only notify on critical cron failures (skip heartbeat/task-queue noise)
    const silentCrons = ['heartbeat', 'task-queue-recovery'];
    if (ALLOWED_CHAT_IDS[0] && !silentCrons.includes(name)) {
      await sendMessage(
        ALLOWED_CHAT_IDS[0],
        `Cron "${name}" failed: ${err.message.slice(0, 300)}`
      ).catch(() => {});
    }
  }
}

// ============================================================
// CRON SCHEDULER
// ============================================================

let cronJobs = [];

function loadCronSchedule() {
  try {
    if (!fs.existsSync(CRON_SCHEDULE_PATH)) {
      log(`No cron schedule at ${CRON_SCHEDULE_PATH}`);
      return;
    }
    const schedule = JSON.parse(fs.readFileSync(CRON_SCHEDULE_PATH, 'utf8'));
    cronJobs = (schedule.crons || []).filter((j) => j.enabled !== false);
    log(`Loaded ${cronJobs.length} cron jobs`);
  } catch (err) {
    log(`WARNING: Failed to load cron schedule: ${err.message}`);
  }
}

function matchField(field, value) {
  if (field === '*') return true;

  // Step: */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }

  // Comma-separated: 1,5,10
  if (field.includes(',')) {
    return field.split(',').some((f) => matchField(f.trim(), value));
  }

  // Range: 1-5
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }

  // Exact match
  return parseInt(field, 10) === value;
}

function shouldFireCron(expr, now) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [min, hour, dom, month, dow] = parts;
  return (
    matchField(min, now.getMinutes()) &&
    matchField(hour, now.getHours()) &&
    matchField(dom, now.getDate()) &&
    matchField(month, now.getMonth() + 1) &&
    matchField(dow, now.getDay())
  );
}

// Track last fire time to prevent duplicate fires within the same minute
const lastFired = {};

function checkCrons() {
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

  for (const job of cronJobs) {
    if (!shouldFireCron(job.schedule, now)) continue;

    const fireKey = `${job.name}:${minuteKey}`;
    if (lastFired[fireKey]) continue;
    lastFired[fireKey] = true;

    log(`Cron matched: ${job.name} (${job.schedule})`);
    enqueueCron({
      name: job.name,
      prompt: job.prompt,
      timeout: job.timeout || 300,
      model: job.model,
    });
  }

  // Clean old fire keys (keep last 100)
  const keys = Object.keys(lastFired);
  if (keys.length > 100) {
    for (const k of keys.slice(0, keys.length - 100)) {
      delete lastFired[k];
    }
  }
}

// ============================================================
// TELEGRAM POLLING
// ============================================================

let pollErrors = 0;

async function pollTelegram() {
  try {
    const updates = await tg('getUpdates', {
      offset: state.updateOffset,
      timeout: 30,
      allowed_updates: ['message'],
    });

    pollErrors = 0; // Reset error counter on success

    for (const update of updates) {
      state.updateOffset = update.update_id + 1;

      const msg = update.message;
      if (!msg) continue;

      const chatId = msg.chat.id;

      // Auth check
      if (!ALLOWED_CHAT_IDS.includes(chatId)) {
        log(`Blocked message from unauthorized chat ${chatId}`);
        continue;
      }

      // Handle /stop immediately — bypass queue, kill active subprocess
      if (msg.text && msg.text.trim().toLowerCase() === '/stop') {
        if (activeSubprocess) {
          log(`/stop received — killing active subprocess (PID ${activeSubprocess.pid})`);
          activeSubprocess.kill('SIGTERM');
          setTimeout(() => {
            if (activeSubprocess) activeSubprocess.kill('SIGKILL');
          }, 5000);
          // Clear the message queue so queued messages don't fire after stop
          telegramQueue.length = 0;
          await sendMessage(chatId, 'Stopped. Task killed and queue cleared.');
        } else {
          await sendMessage(chatId, 'Nothing running to stop.');
        }
        continue;
      }

      // Handle /restart — send confirmation then restart the service
      if (msg.text && msg.text.trim().toLowerCase() === '/restart') {
        const restartCmd = config.restartCommand;
        if (!restartCmd) {
          await sendMessage(chatId, 'No restartCommand configured in config.json.');
          continue;
        }
        log('/restart received — restarting service...');
        await sendMessage(chatId, "Restarting... I'll be back in a few seconds.");
        setTimeout(() => {
          require('child_process').exec(restartCmd.replace(/~/g, process.env.HOME || process.env.USERPROFILE), (err) => {
            if (err) log(`Restart error: ${err.message}`);
          });
        }, 500);
        continue;
      }

      // Handle text messages
      if (msg.text) {
        enqueueTelegram({
          chatId,
          text: msg.text,
          username: msg.from?.username,
          firstName: msg.from?.first_name,
        });
      }

      // Handle voice messages — transcribe with Whisper, send to Claude
      if (msg.voice) {
        try {
          const voicePath = await downloadTelegramFile(msg.voice.file_id, 'voice');
          const voiceSender = msg.from?.first_name || msg.from?.username || 'User';
          log(`Voice message from ${voiceSender}: ${msg.voice.duration}s`);
          const transcript = await transcribeVoice(voicePath);
          log(`Transcribed voice: ${transcript.substring(0, 100)}...`);
          // Clean up audio file
          try { fs.unlinkSync(voicePath); } catch {}
          if (transcript) {
            enqueueTelegram({
              chatId,
              text: transcript,
              username: msg.from?.username,
              firstName: msg.from?.first_name,
            });
          } else {
            await sendMessage(chatId, "Couldn't transcribe that voice message. Try again or send text.");
          }
        } catch (err) {
          log(`Voice transcription failed: ${err.message}`);
          await sendMessage(chatId, `Voice transcription failed: ${err.message}`);
        }
      }

      // Handle audio files (forwarded voice notes, audio attachments)
      if (msg.audio) {
        try {
          const audioPath = await downloadTelegramFile(msg.audio.file_id, 'audio');
          const audioSender = msg.from?.first_name || msg.from?.username || 'User';
          log(`Audio file from ${audioSender}: ${msg.audio.duration}s`);
          const transcript = await transcribeVoice(audioPath);
          log(`Transcribed audio: ${transcript.substring(0, 100)}...`);
          try { fs.unlinkSync(audioPath); } catch {}
          if (transcript) {
            enqueueTelegram({
              chatId,
              text: transcript,
              username: msg.from?.username,
              firstName: msg.from?.first_name,
            });
          } else {
            await sendMessage(chatId, "Couldn't transcribe that audio. Try again or send text.");
          }
        } catch (err) {
          log(`Audio transcription failed: ${err.message}`);
          await sendMessage(chatId, `Audio transcription failed: ${err.message}`);
        }
      }

      // Handle photos
      if (msg.photo && !msg.text) {
        const photo = msg.photo[msg.photo.length - 1]; // highest resolution
        try {
          const imagePath = await downloadTelegramFile(photo.file_id);
          const caption = msg.caption || 'Describe what you see.';
          enqueueTelegram({
            chatId,
            text: `Read the image at ${imagePath} and respond to it. ${caption}`,
            username: msg.from?.username,
            firstName: msg.from?.first_name,
            _imagePath: imagePath,
          });
        } catch (err) {
          log(`Failed to download photo: ${err.message}`);
          await sendMessage(chatId, `Failed to download image: ${err.message}`);
        }
      }

      // Handle document uploads (images + files)
      if (msg.document) {
        const mime = msg.document.mime_type || '';
        const fileName = msg.document.file_name || 'unknown';
        const caption = msg.caption || '';

        // Supported file types
        const imageTypes = ['image/'];
        const fileTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
          'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
          'application/msword', // doc
          'application/vnd.ms-excel', // xls
          'text/plain',
          'text/csv',
          'text/markdown',
          'application/json',
          'application/xml',
          'text/html',
        ];

        const isImage = imageTypes.some(t => mime.startsWith(t));
        const isFile = fileTypes.some(t => mime === t) || fileName.match(/\.(pdf|docx?|xlsx?|pptx?|txt|csv|md|json|xml|html)$/i);

        if (isImage) {
          try {
            const imagePath = await downloadTelegramFile(msg.document.file_id, 'photo');
            const prompt = caption || 'Describe what you see.';
            enqueueTelegram({
              chatId,
              text: `Read the image at ${imagePath} and respond to it. ${prompt}`,
              username: msg.from?.username,
              firstName: msg.from?.first_name,
              _imagePath: imagePath,
            });
          } catch (err) {
            log(`Failed to download document image: ${err.message}`);
            await sendMessage(chatId, `Failed to download image: ${err.message}`);
          }
        } else if (isFile) {
          try {
            const filePath = await downloadTelegramFile(msg.document.file_id, 'doc');
            const prompt = caption || `Read and summarize this file: ${fileName}`;
            const senderName = msg.from?.first_name || msg.from?.username || 'User';
            log(`File attachment from ${senderName}: ${fileName} (${mime})`);
            enqueueTelegram({
              chatId,
              text: `Read the file at ${filePath} (original name: ${fileName}). ${prompt}`,
              username: msg.from?.username,
              firstName: msg.from?.first_name,
              _imagePath: filePath, // reuse cleanup mechanism
            });
          } catch (err) {
            log(`Failed to download file: ${err.message}`);
            await sendMessage(chatId, `Failed to download file: ${err.message}`);
          }
        } else {
          await sendMessage(chatId, `${mime || 'Unknown'} file type not supported. Supported: images, PDF, DOCX, XLSX, PPTX, TXT, CSV, JSON, Markdown.`);
        }
      }
    }

    saveState();
  } catch (err) {
    pollErrors++;
    const backoff = Math.min(pollErrors * 2, 15);
    log(`Telegram poll error (attempt ${pollErrors}): ${err.message}. Retrying in ${backoff}s...`);
    await sleep(backoff * 1000);
  }
}

// ============================================================
// UTILITIES
// ============================================================

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    log(`WARNING: Failed to save state: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const provider = config.provider || 'claude';
  const cliName = provider === 'codex' ? 'codex' : 'claude';

  log('========================================');
  log('Telegram Bridge starting');
  log(`Workspace: ${WORKSPACE}`);
  log(`MCP Config: ${MCP_CONFIG}`);
  log(`Allowed chats: ${ALLOWED_CHAT_IDS.join(', ')}`);
  log(`Model: ${DEFAULT_MODEL}`);
  log(`Provider: ${provider}`);
  log('========================================');

  // Verify CLI is available
  try {
    const { execSync } = require('child_process');
    const version = execSync(`${cliName} --version 2>/dev/null || echo "unknown"`).toString().trim();
    log(`Starting NativeClaw bridge (${cliName} ${version})`);
  } catch {
    log(`WARNING: Could not detect ${cliName} version`);
  }

  // Validate bot token
  try {
    const me = await tg('getMe');
    log(`Bot: @${me.username} (${me.first_name})`);
  } catch (err) {
    log(`FATAL: Invalid bot token: ${err.message}`);
    process.exit(1);
  }

  // Load cron schedule
  loadCronSchedule();

  // Start cron checker — runs every 60 seconds
  setInterval(checkCrons, 60000);
  // Initial cron check
  checkCrons();

  // Reload cron schedule every 5 minutes (picks up changes without restart)
  setInterval(loadCronSchedule, 300000);

  // Start Telegram polling loop
  log('Telegram polling started');
  while (true) {
    await pollTelegram();
  }
}

// Graceful shutdown
function shutdown(signal) {
  log(`Received ${signal}, shutting down...`);
  saveState();
  // Clean up PID file
  try { fs.unlinkSync(PID_PATH); } catch {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`);
  saveState();
  process.exit(1);
});

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
