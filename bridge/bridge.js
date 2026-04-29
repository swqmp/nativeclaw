#!/usr/bin/env node

// Telegram Bridge for Claude Code Native Setup
// Custom built — no external dependencies, Node.js built-in modules only
// Handles: Telegram message reception/response + cron job scheduling
// Version: 1.10.0 — agent reliability stack (memory, MCP health, context preservation, QoL)
//
// Architecture:
//   Telegram polling → message queue → claude -p subprocess → response back to Telegram
//   Cron scheduler → cron queue → active backend subprocess / shell command → logs / Telegram
//   Two concurrent workers (telegram + cron) so messages aren't blocked by long crons

const { spawn, execSync } = require('child_process');
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

function toClaudeProjectDir(workspacePath) {
  const resolved = path.resolve(workspacePath);
  const slug = resolved.replace(/[\\/.:]/g, '-');
  return path.join(HOME_DIR, '.claude', 'projects', slug);
}

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
const SESSION_DAY_TIMEZONE = config.sessionTimeZone || process.env.NATIVECLAW_SESSION_TIMEZONE || 'America/New_York';
const AGENT_LABEL = config.agentName || 'the NativeClaw agent';
const USER_LABEL = config.userName || 'the user';

// Per-chat settings (model overrides, effort, verbosity, etc.)
let chatSettings = {};

// Load or initialize state
let state = {
  updateOffset: 0,
  sessions: {},         // { chatId: string } — Claude session IDs (legacy flat shape, kept for compat)
  sessionDates: {},     // { chatId: "YYYY-MM-DD" } — day bound for Claude sessions
  codexSessions: {},    // { chatId: string } — Codex thread IDs
  codexSessionDates: {},// { chatId: "YYYY-MM-DD" } — day bound for Codex sessions
  backends: {},         // { chatId: "claude" | "codex" }
  pendingTransfer: {},  // { chatId: {from, to, context?} } — one-shot flag to inject cross-backend context on next message
  sessionStartRanToday: '',  // YYYY-MM-DD — set once SESSION START ran today on either backend; implicitly cleared when day rolls (5 AM ET anchor)
  arrivedAt: {},        // { chatId: { claude: ISO, codex: ISO } } — when the user most recently arrived at each backend; gap-transcript boundary
  firstRun: {},         // { chatId: { greetedAt: ISO } } — Telegram-first onboarding already shown
  exchangeCount: {},
};
if (fs.existsSync(STATE_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    state = { ...state, ...loaded };
    // Back-fill any missing fields from older state.json versions
    if (!state.exchangeCount) state.exchangeCount = {};
    if (!state.sessionDates) state.sessionDates = {};
    if (!state.codexSessions) state.codexSessions = {};
    if (!state.codexSessionDates) state.codexSessionDates = {};
    if (!state.backends) state.backends = {};
    if (!state.pendingTransfer) state.pendingTransfer = {};
    if (typeof state.sessionStartRanToday !== 'string') state.sessionStartRanToday = '';
    if (!state.arrivedAt || typeof state.arrivedAt !== 'object') state.arrivedAt = {};
    if (!state.firstRun || typeof state.firstRun !== 'object') state.firstRun = {};
    const today = getCurrentSessionDay();
    for (const [cid, sid] of Object.entries(state.sessions)) {
      if (sid && !state.sessionDates[cid]) state.sessionDates[cid] = today;
    }
    for (const [cid, tid] of Object.entries(state.codexSessions)) {
      if (tid && !state.codexSessionDates[cid]) state.codexSessionDates[cid] = today;
    }
    // Restore persisted chat settings (model choices survive restart)
    if (loaded.chatSettings) {
      for (const [cid, s] of Object.entries(loaded.chatSettings)) {
        chatSettings[cid] = { ...s, lastResult: null };
      }
    }
  } catch {
    // Corrupted state, keep defaults
  }
}

function getBackend(chatId) {
  return state.backends[String(chatId)] || config.defaultBackend || 'claude';
}

function buildFirstRunWelcome() {
  return [
    `${AGENT_LABEL} is connected.`,
    '',
    'This chat is the main control surface. Tell me who you are, what you want help with, and what apps or tools you eventually want connected.',
    '',
    'I can help turn that into durable workspace memory: USER.md for you, MEMORY.md for ongoing context, and TOOLS.md for local tool setup.',
    '',
    'Useful commands: /status checks the bridge, /help lists commands, and /claude or /codex switch backends if both are installed.',
  ].join('\n');
}

function buildFirstRunPromptContext() {
  return [
    '# FIRST-RUN ONBOARDING CONTEXT',
    '',
    'This is the user\'s first non-command Telegram message after setup.',
    'Help them establish durable context. If they introduce themselves, offer to save stable facts to USER.md, MEMORY.md, and TOOLS.md as appropriate.',
    'Keep the response concise and practical.',
    '',
    '# END FIRST-RUN ONBOARDING CONTEXT',
  ].join('\n');
}

function getCurrentSessionDay(date = new Date()) {
  // Session day anchored at 05:00 ET. Hours 00:00-04:59 ET count as the previous day
  // so mid-conversation midnight does not force-kill a live session. The 5:10 AM
  // session-audit cron is the safety-net rotation trigger.
  const etHourParts = new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_DAY_TIMEZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const etHour = parseInt((etHourParts.find((p) => p.type === 'hour') || { value: '0' }).value, 10);
  const anchorDate = etHour < 5 ? new Date(date.getTime() - 24 * 60 * 60 * 1000) : date;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_DAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(anchorDate);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getSessionStores(kind) {
  if (kind === 'codex') {
    return { ids: state.codexSessions, dates: state.codexSessionDates, label: 'Codex thread' };
  }
  return { ids: state.sessions, dates: state.sessionDates, label: 'Claude session' };
}

function clearStoredSession(kind, chatId, reason = '') {
  const key = String(chatId);
  const { ids, dates, label } = getSessionStores(kind);
  const id = ids[key];
  if (reason && id) {
    log(`${label} ${id} cleared for ${key}: ${reason}`);
  }
  delete ids[key];
  delete dates[key];
  clearBackendArrival(chatId, kind);
}

function getStoredSessionId(kind, chatId) {
  const key = String(chatId);
  const today = getCurrentSessionDay();
  const { ids, dates, label } = getSessionStores(kind);
  const id = ids[key];
  if (!id) return null;
  const sessionDay = dates[key];
  if (sessionDay === today) return id;
  log(`${label} ${id} for ${key} is stale (stored=${sessionDay || 'unknown'}, today=${today}); ignoring it`);
  clearStoredSession(kind, chatId);
  saveState();
  return null;
}

function setStoredSessionId(kind, chatId, id) {
  const key = String(chatId);
  const { ids, dates } = getSessionStores(kind);
  ids[key] = id;
  dates[key] = getCurrentSessionDay();
  // First time this backend sees activity today? Mark arrival so future gap-transcript
  // calculations have a boundary. /claude and /codex slash handlers will overwrite this
  // with a fresh now() after gap injection if the user is explicitly switching.
  if (!state.arrivedAt[key]) state.arrivedAt[key] = {};
  if (!state.arrivedAt[key][kind]) state.arrivedAt[key][kind] = new Date().toISOString();
}

function getBackendArrival(chatId, backend) {
  const key = String(chatId);
  return (state.arrivedAt[key] && state.arrivedAt[key][backend]) || null;
}

function markBackendArrival(chatId, backend, when) {
  const key = String(chatId);
  if (!state.arrivedAt[key]) state.arrivedAt[key] = {};
  state.arrivedAt[key][backend] = when || new Date().toISOString();
}

function clearBackendArrival(chatId, backend) {
  const key = String(chatId);
  if (!state.arrivedAt[key]) return;
  delete state.arrivedAt[key][backend];
  if (Object.keys(state.arrivedAt[key]).length === 0) delete state.arrivedAt[key];
}

function formatGapTimestamp(iso) {
  if (!iso) return '?';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: SESSION_DAY_TIMEZONE,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).format(d);
  } catch {
    return iso;
  }
}

function setBackend(chatId, backend, transfer = undefined) {
  const key = String(chatId);
  const prev = getBackend(chatId);
  state.backends[key] = backend;
  if (prev !== backend) {
    // Daily backend sessions are paused/resumed across switches. Continuity
    // still flows through a handoff, but the target backend keeps its own
    // same-day session/thread unless the daily reset or explicit recovery clears it.
    // Queue a one-shot context transfer on the next message.
    // `transfer.context` can be precomputed by slash commands so the first
    // real message on the new backend does not pay the handoff latency.
    state.pendingTransfer[key] = { from: prev, to: backend, ...(transfer || {}) };
  }
  saveState();
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

function nativeClawEnv() {
  return {
    NATIVECLAW_WORKSPACE: process.env.NATIVECLAW_WORKSPACE || WORKSPACE,
    NATIVECLAW_PROJECT_DIR: process.env.NATIVECLAW_PROJECT_DIR || toClaudeProjectDir(WORKSPACE),
    NATIVECLAW_KEYCHAIN_ACCOUNT: process.env.NATIVECLAW_KEYCHAIN_ACCOUNT || process.env.USER || process.env.USERNAME || 'nativeclaw',
  };
}

// ============================================================
// SESSION PRIMER — inject recent daily logs on fresh sessions
// ============================================================
// When a session is cleared (by /reset or session-audit cron), the next
// message spawns a fresh claude -p with no memory of prior days. AGENTS.md
// tells the agent to read the last 3 daily logs on session start, but that's a
// rule, not a mechanism. This injects the logs via --append-system-prompt
// so they're guaranteed to be loaded.

function buildSessionPrimer(options = {}) {
  const sessionStartDone = Boolean(options.sessionStartDone);
  try {
    if (!fs.existsSync(MEMORY_DIR)) return null;
    const files = fs.readdirSync(MEMORY_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, 3);

    if (files.length === 0) return null;

    const sections = [];
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8');
        if (content.trim().length < 100) continue; // skip stub files
        sections.push(`=== memory/${f} ===\n${content.trim()}`);
      } catch {}
    }

    if (sections.length === 0) return null;

    return [
      '# RECENT CONTEXT (auto-injected on fresh session)',
      '',
      `SESSION_START_COMPLETED_TODAY=${sessionStartDone ? 'true' : 'false'}`,
      '',
      'Your session was cleared since the last conversation. Below are the 3 most recent daily logs so you have continuity. Read them before responding to the user\'s message.',
      '',
      sections.join('\n\n'),
    ].join('\n');
  } catch (err) {
    log(`Session primer build failed: ${err.message}`);
    return null;
  }
}

// ============================================================
// CODEX BACKEND — models, context, transcript replay
// ============================================================

const CODEX_MODELS = {
  '5.5':             { id: 'gpt-5.5',             display: 'GPT-5.5 (frontier, default)' },
  '5.4':             { id: 'gpt-5.4',             display: 'GPT-5.4' },
  '5.4-mini':        { id: 'gpt-5.4-mini',        display: 'GPT-5.4 Mini' },
  '5.3-codex':       { id: 'gpt-5.3-codex',       display: 'GPT-5.3 Codex' },
  '5.2':             { id: 'gpt-5.2',             display: 'GPT-5.2' },
  '5.2-codex':       { id: 'gpt-5.2-codex',       display: 'GPT-5.2 Codex' },
  '5.1-codex-max':   { id: 'gpt-5.1-codex-max',   display: 'GPT-5.1 Codex Max' },
  '5.1-codex-mini':  { id: 'gpt-5.1-codex-mini',  display: 'GPT-5.1 Codex Mini' },
};
const CODEX_DEFAULT_MODEL = 'gpt-5.5';
const GAP_CAP_CHARS = 50000; // Hard cap on injected backend-switch gap transcript size; oldest events drop first if exceeded.

// Files to inject as standing context on fresh Codex threads.
// AGENTS.md is excluded because Codex auto-loads it from the workspace.
const CODEX_BASE_CONTEXT_FILES = [
  'SOUL.md',
  'USER.md',
  'TOOLS.md',
  'NATIVECLAW.md',
  'device.md',
];

const CODEX_PREAMBLE = `# CODEX BACKEND — OPERATING CONSTRAINTS

You are ${AGENT_LABEL}, running through the OpenAI Codex CLI as an alternate backend.
${USER_LABEL} switched to you from Claude. Continue using the same workspace identity
(SOUL.md), user context (USER.md), tool notes (TOOLS.md), runtime notes
(NATIVECLAW.md), device reference (device.md), and durable memory (MEMORY.md).

## What you CAN do
- Read and write files on this device
- Run available shell commands (python, node, git, etc.)
- Chat, brainstorm, answer questions
- Edit code, build websites, run scripts
- Access the internet via configured tools or shell commands when available
- MCP tools — config can be mirrored in ~/.codex/config.toml for this install
- Bridge-level cron jobs, heartbeats, and session-audit can run while either
  Claude or Codex is active. The bridge owns scheduling.

## What you CANNOT do
- Claude Code skills (/commit, /banana, /gsd-*, etc.) — those are Claude-specific
- Codex does not have its own native cron system
- Claude-specific flags (--append-system-prompt, --mcp-config, etc.)

## Rules that still apply
- Identity, personality, tone from SOUL.md
- Git rules from AGENTS.md — never commit/push/deploy without permission
- Honesty rules — never fabricate, never say "done" without doing it
- Memory writes — use file-editing tools or python to write to workspace files
- Durable context from MEMORY.md; live external data comes from the configured tools/APIs
- Tool-Use Enforcement from AGENTS.md — MUST call tools before answering data questions

## Memory Retrieval
If the QMD search_memory MCP tool is configured, use it for history questions.
It semantically searches daily logs, MEMORY.md, and feedback files. When the user
asks about a person, company, past event, decision, price, agreement, or history,
call search_memory before answering. If QMD is not enabled, use the best
available local/tool-backed source instead of guessing from standing context.

When you see instructions referencing Claude-specific features like Claude
Code slash commands, skip them silently. MCP tools that are configured for
Codex are available to you, so use them when the task requires tool-backed data.
`;

function extractLatestCheckpoint(logContent) {
  const chunks = logContent.split(/^## /m).filter(Boolean);
  if (chunks.length === 0) return null;
  const latest = chunks[chunks.length - 1].trim();
  const lines = latest.split('\n');
  if (lines.length > 40) return lines.slice(0, 40).join('\n') + '\n[...truncated]';
  return latest;
}

// Context profiles control how much gets injected per interaction type.
// Codex standing context mirrors Claude's fresh-session primer for parity:
// - All chat turns get SOUL + USER + TOOLS + MEMORY + NATIVECLAW + device.
//   (AGENTS.md is auto-loaded by Codex from the workspace.)
// - Fresh threads also get the last 3 full daily logs, matching Claude.
// `work` and `chat` profiles collapsed into one. `cron` path uses buildCodexCronContext
// directly and does not pass through this function.
const CODEX_STANDING_FILES = [...CODEX_BASE_CONTEXT_FILES, 'MEMORY.md'];

function buildCodexContext(options = {}) {
  const sessionStartDone = Boolean(options.sessionStartDone);
  const sections = [];

  for (const fname of CODEX_STANDING_FILES) {
    const fpath = path.join(WORKSPACE, fname);
    try {
      if (!fs.existsSync(fpath)) continue;
      const content = fs.readFileSync(fpath, 'utf8').trim();
      if (content.length < 50) continue;
      sections.push(`=== ${fname} ===\n${content}`);
    } catch {}
  }

  // Inject last 3 full daily logs on fresh thread (matches Claude primer)
  try {
    if (fs.existsSync(MEMORY_DIR)) {
      const files = fs.readdirSync(MEMORY_DIR)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, 3);
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8').trim();
          if (content.length < 100) continue;
          sections.push(`=== memory/${f} ===\n${content}`);
        } catch {}
      }
    }
  } catch {}

  if (sections.length === 0) return '';

  return [
    '# STANDING CONTEXT',
    '',
    `SESSION_START_COMPLETED_TODAY=${sessionStartDone ? 'true' : 'false'}`,
    '',
    sections.join('\n\n'),
    '',
    '# END STANDING CONTEXT',
  ].join('\n');
}

function buildCodexCronContext() {
  return [
    '# CODEX CRON CONTEXT',
    '',
    `You are ${AGENT_LABEL}, running a scheduled background cron through the Telegram bridge.`,
    `Workspace: ${WORKSPACE}`,
    '',
    'Rules:',
    '- Obey AGENTS.md and workspace memory rules.',
    '- Use MCP tools when the cron prompt asks for external data.',
    '- Read SOUL.md, USER.md, MEMORY.md, TOOLS.md, NATIVECLAW.md, device.md, daily logs, or feedback files only when needed for the specific cron.',
    '- Do not send Telegram messages unless the cron prompt explicitly tells you to.',
    '- Keep silent maintenance tasks silent.',
  ].join('\n');
}

// Find the rollout file for a Codex thread.
// Codex rollout path: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl
function findCodexRolloutPath(threadId) {
  if (!threadId) return '';
  try {
    const sessionsRoot = path.join(HOME_DIR, '.codex', 'sessions');
    if (!fs.existsSync(sessionsRoot)) return '';

    // Walk year/month/day to find the rollout file matching this thread_id
    let rolloutPath = null;
    const years = fs.readdirSync(sessionsRoot).sort().reverse();
    outer: for (const y of years) {
      const yp = path.join(sessionsRoot, y);
      if (!fs.statSync(yp).isDirectory()) continue;
      const months = fs.readdirSync(yp).sort().reverse();
      for (const m of months) {
        const mp = path.join(yp, m);
        if (!fs.statSync(mp).isDirectory()) continue;
        const days = fs.readdirSync(mp).sort().reverse();
        for (const d of days) {
          const dp = path.join(mp, d);
          if (!fs.statSync(dp).isDirectory()) continue;
          const files = fs.readdirSync(dp);
          const match = files.find(f => f.endsWith(`${threadId}.jsonl`));
          if (match) {
            rolloutPath = path.join(dp, match);
            break outer;
          }
        }
      }
    }
    return rolloutPath || '';
  } catch (err) {
    log(`findCodexRolloutPath failed: ${err.message}`);
    return '';
  }
}

// Extract filtered user/assistant exchanges from a Codex session rollout.
function extractCodexTranscriptExchanges(threadId, maxExchanges = 30, sinceISO = null) {
  const rolloutPath = findCodexRolloutPath(threadId);
  if (!rolloutPath) return [];
  const sinceMs = sinceISO ? Date.parse(sinceISO) : null;
  try {
    const lines = fs.readFileSync(rolloutPath, 'utf8').trim().split('\n');
    const exchanges = [];
    const seen = new Set();  // dedup user_message events that also echo into response_item

    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        // Codex CLI rollout format (verified Apr 2026):
        //   - User-typed inputs:  ev.type === 'event_msg', ev.payload.type === 'user_message',
        //                         ev.payload.message string contains the user prompt.
        //   - Assistant outputs:  ev.type === 'response_item', ev.payload.type === 'message',
        //                         ev.payload.role === 'assistant', payload.content[] holds
        //                         input_text/output_text parts.
        //   - Older Codex builds also echoed user prompts inside response_item; we still accept
        //     those but the # STANDING CONTEXT / AGENTS.md filter strips the noisy primer dumps.
        //   - Everything else (reasoning, function_call, token_count, turn_context, agent_message
        //     duplicates of response_item, session_meta) is skipped.
        let role = null;
        const texts = [];

        if (ev.type === 'event_msg' && ev.payload && ev.payload.type === 'user_message') {
          role = 'user';
          if (typeof ev.payload.message === 'string') {
            texts.push(ev.payload.message);
          }
        } else if (ev.type === 'response_item') {
          const p = ev.payload;
          if (!p || p.type !== 'message') continue;
          if (p.role !== 'user' && p.role !== 'assistant') continue;
          role = p.role;
          if (Array.isArray(p.content)) {
            for (const c of p.content) {
              if (typeof c.text === 'string' && (c.type === 'input_text' || c.type === 'output_text')) {
                texts.push(c.text);
              }
            }
          }
        } else {
          continue;
        }

        const filtered = [];
        for (let t of texts) {
          t = t.trim();
          if (
            !t ||
            t.startsWith('<permissions') ||
            t.startsWith('<environment') ||
            t.startsWith('<skills_instructions') ||
            t.startsWith('# AGENTS.md instructions') ||
            t.startsWith('# CODEX BACKEND') ||
            t.startsWith('# CODEX CRON CONTEXT') ||
            t.startsWith('# CODEX CONVERSATION TO SUMMARIZE') ||
            t.startsWith('# HANDOFF BRIEF') ||
            t.startsWith('# STANDING CONTEXT')
          ) continue;
          filtered.push(t);
        }
        if (filtered.length === 0) continue;
        const joined = filtered.join('\n').trim();
        if (!joined) continue;
        const ts = (typeof ev.timestamp === 'string') ? ev.timestamp : null;
        if (sinceMs && ts && Date.parse(ts) < sinceMs) continue;
        const dedupKey = `${role}:${joined.slice(0, 200)}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        exchanges.push({ role, text: joined.slice(0, 4000), timestamp: ts });
      } catch {}
    }

    return exchanges.slice(-maxExchanges);
  } catch (err) {
    log(`extractCodexTranscriptExchanges failed: ${err.message}`);
    return [];
  }
}

// Build a gap transcript: filtered + timestamped tail of the source backend's
// session/thread since the user last arrived at it. Replaces the old summary+replay
// dual path. Returns formatted block or '' if no events / no session.
function buildGapTranscript(sourceBackend, sessionKey, sinceISO) {
  const sessionId = sourceBackend === 'codex'
    ? getStoredSessionId('codex', sessionKey)
    : getStoredSessionId('claude', sessionKey);
  if (!sessionId) return '';

  const exchanges = sourceBackend === 'codex'
    ? extractCodexTranscriptExchanges(sessionId, 9999, sinceISO)
    : extractClaudeTranscriptExchanges(sessionId, 9999, sinceISO);
  if (exchanges.length === 0) return '';

  // Hard cap (oldest drops first) so a heavy session doesn't blow up Claude/Codex
  // context windows on switch.
  let totalChars = exchanges.reduce((sum, e) => sum + (e.text || '').length + 60, 0);
  let truncated = 0;
  while (totalChars > GAP_CAP_CHARS && exchanges.length > 1) {
    const dropped = exchanges.shift();
    totalChars -= (dropped.text || '').length + 60;
    truncated++;
  }

  const sourceLabel = sourceBackend === 'codex' ? 'Codex' : 'Claude';
  const targetLabel = sourceBackend === 'codex' ? 'Claude' : 'Codex';

  const lines = [
    `# GAP TRANSCRIPT (from ${sourceLabel} session, while you were on the other backend)`,
    '',
    `The user just switched from ${sourceLabel} back to you (${targetLabel}). Below is the conversation that happened on ${sourceLabel} during the gap, with timestamps. Continue naturally — do not re-greet, do not re-summarize. Pick up where things left off.`,
    '',
  ];
  if (truncated > 0) {
    lines.push(`[${truncated} earlier message(s) truncated to fit ${GAP_CAP_CHARS}-char cap]`);
    lines.push('');
  }
  for (const e of exchanges) {
    const tag = (e.role || '?').toUpperCase();
    const time = formatGapTimestamp(e.timestamp);
    lines.push(`[${time} \u2014 ${tag}]: ${e.text}`);
    lines.push('');
  }
  lines.push('# END GAP TRANSCRIPT');
  return lines.join('\n');
}

// Extract filtered user/assistant exchanges from a Claude session transcript.
function extractClaudeTranscriptExchanges(sessionId, maxExchanges = 30, sinceISO = null) {
  if (!sessionId) return [];
  const sinceMs = sinceISO ? Date.parse(sinceISO) : null;
  try {
    const transcriptDir = toClaudeProjectDir(WORKSPACE);
    const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(transcriptPath)) return [];

    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    const exchanges = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const ts = (typeof entry.timestamp === 'string') ? entry.timestamp : null;
        if (sinceMs && ts && Date.parse(ts) < sinceMs) continue;
        if (entry.type === 'user' && entry.message?.content) {
          const content = Array.isArray(entry.message.content)
            ? entry.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
            : entry.message.content;
          if (typeof content === 'string' && content.trim() && !content.startsWith('<')) {
            exchanges.push({ role: 'user', text: content.trim().slice(0, 4000), timestamp: ts });
          }
        } else if (entry.type === 'assistant' && entry.message?.content) {
          const content = Array.isArray(entry.message.content)
            ? entry.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
            : entry.message.content;
          if (typeof content === 'string' && content.trim()) {
            exchanges.push({ role: 'assistant', text: content.trim().slice(0, 4000), timestamp: ts });
          }
        }
      } catch {}
    }

    return exchanges.slice(-maxExchanges);
  } catch (err) {
    log(`extractClaudeTranscriptExchanges failed: ${err.message}`);
    return [];
  }
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

async function sendPhoto(chatId, imagePath, caption = '') {
  const FormData = require('form-data');
  const https = require('https');
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', fs.createReadStream(imagePath));
    if (caption) form.append('caption', caption);
    const options = {
      method: 'POST',
      host: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendPhoto`,
      headers: form.getHeaders(),
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.ok) { log(`sendPhoto failed: ${data.description}`); sendMessage(chatId, `[Image failed to send: ${data.description}]`); }
          resolve(data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', err => { log(`sendPhoto error: ${err.message}`); sendMessage(chatId, `[Image failed to send: ${err.message}]`); reject(err); });
    form.pipe(req);
  });
}

// Convert GitHub-flavored markdown to Telegram-compatible HTML
function mdToHtml(text) {
  const codeBlocks = [];
  const inlineCode = [];

  // Extract code blocks first (preserve content, escape HTML inside them)
  text = text.replace(/```\w*\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Extract inline code
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    inlineCode.push(code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    return `\x00IC${inlineCode.length - 1}\x00`;
  });

  // Escape HTML in remaining text
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Headers → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic
  text = text.replace(/\*(.+?)\*/g, '<i>$1</i>');
  text = text.replace(/_(.+?)_/g, '<i>$1</i>');

  // Horizontal rules → remove
  text = text.replace(/^---+$/gm, '');

  // Tables → space-separated plain text
  text = text.replace(/^\|(.+)\|$/gm, (_, row) =>
    row.split('|').map(c => c.trim()).filter(Boolean).join('   ')
  );
  text = text.replace(/^[\s|:-]+$/gm, '');

  // Restore inline code and code blocks
  text = text.replace(/\x00IC(\d+)\x00/g, (_, i) => `<code>${inlineCode[i]}</code>`);
  text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => `<pre>${codeBlocks[i]}</pre>`);

  return text;
}

async function sendMessage(chatId, text) {
  const html = mdToHtml(text);
  const chunks = splitText(html, 4000);
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    try {
      await tg('sendMessage', { chat_id: chatId, text: chunks[i], parse_mode: 'HTML' });
      sentCount++;
    } catch (err) {
      // HTML parse failed for this chunk, retry it as plain text
      log(`HTML send failed on chunk ${i + 1}/${chunks.length}: ${err.message}`);
      try {
        // Strip HTML tags for plain text fallback of THIS chunk only
        const plain = chunks[i].replace(/<[^>]+>/g, '');
        await tg('sendMessage', { chat_id: chatId, text: plain });
        sentCount++;
      } catch (retryErr) {
        failedCount++;
        log(`sendMessage chunk ${i + 1}/${chunks.length} FAILED (both HTML and plain): ${retryErr.message}`);
      }
    }
  }

  if (failedCount > 0) {
    log(`WARNING: ${failedCount}/${chunks.length} message chunks failed to send`);
  }
  return { sent: sentCount, failed: failedCount, total: chunks.length };
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
    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt).trimStart();

    // Fix unclosed HTML tags in this chunk
    const openTags = [];
    const tagRegex = /<\/?([a-z]+)>/gi;
    let match;
    while ((match = tagRegex.exec(chunk)) !== null) {
      if (match[0].startsWith('</')) {
        // Closing tag — pop if it matches
        if (openTags.length > 0 && openTags[openTags.length - 1] === match[1].toLowerCase()) {
          openTags.pop();
        }
      } else {
        openTags.push(match[1].toLowerCase());
      }
    }
    // Close any unclosed tags at end of chunk (reverse order)
    if (openTags.length > 0) {
      chunk += openTags.reverse().map(t => `</${t}>`).join('');
      // Re-open them at the start of the remaining text
      remaining = openTags.reverse().map(t => `<${t}>`).join('') + remaining;
    }

    chunks.push(chunk);
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
  const https = require('https');
  const openaiKey = config.openaiApiKey;

  if (!openaiKey) {
    throw new Error('No OpenAI API key in config.json — cannot transcribe voice');
  }

   return new Promise((resolve, reject) => {
     const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);
     const audioBuffer = fs.readFileSync(audioPath);
     const fileName = path.basename(audioPath);

     const parts = [];
     parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`));
     parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`));
     parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/ogg\r\n\r\n`));
     parts.push(audioBuffer);
     parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
     const body = Buffer.concat(parts);

     // keepAlive: false prevents stale connections from being reused across requests
     const agent = new https.Agent({ keepAlive: false });

     const options = {
       hostname: 'api.openai.com',
       path: '/v1/audio/transcriptions',
       method: 'POST',
       agent,
       headers: {
         'Authorization': `Bearer ${openaiKey}`,
         'Content-Type': `multipart/form-data; boundary=${boundary}`,
         'Content-Length': body.length
       }
     };

     let settled = false;
     const done = (fn, val) => { if (!settled) { settled = true; clearTimeout(hardTimer); fn(val); } };

     // Hard wall-clock timeout — catches stalled response bodies that fool the socket idle check
     const hardTimer = setTimeout(() => {
       req.destroy();
       done(reject, new Error('OpenAI Whisper API timeout (45s hard limit)'));
     }, 45000);

     const req = https.request(options, (res) => {
       let data = '';
       res.on('data', chunk => data += chunk);
       res.on('end', () => {
         try {
           const result = JSON.parse(data);
           if (result.text) {
             done(resolve, result.text.trim());
           } else {
             done(reject, new Error(result.error?.message || 'No transcript in OpenAI response'));
           }
         } catch (e) {
           done(reject, new Error(`Failed to parse OpenAI response: ${data}`));
         }
       });
       res.on('error', err => done(reject, err));
     });

     req.on('error', err => done(reject, err));
     req.write(body);
     req.end();
   });
 }


// Extract ALL assistant text blocks from the last conversation turn in a session JSONL.
// Claude Code's result.result only captures the LAST text block, dropping any text
// produced BEFORE tool calls in the same turn. This reads the JSONL to get everything.
function extractFullResponseFromSession(sessionId) {
  if (!sessionId) return null;
  try {
    const transcriptDir = toClaudeProjectDir(WORKSPACE);
    const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(transcriptPath)) return null;

    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');

    // Collect assistant text blocks from the LAST user->assistant exchange.
    // Walk backwards to find the last REAL user message, then collect all
    // assistant text blocks that follow it.
    //
    // Skip entries that are typed as "user" but aren't actual user input:
    //  - task-notifications (origin.kind === "task-notification") — injected
    //    mid-turn when a background Bash task completes. Treating these as
    //    user messages truncated replies to the text after the notification,
    //    losing the real response.
    //  - compact summaries (isCompactSummary === true) — injected after context
    //    compaction.
    //  - tool-result entries (content is an array with tool_result objects) —
    //    these aren't user input either.
    function isRealUserMessage(entry) {
      if (entry.type !== 'user') return false;
      if (entry.origin && entry.origin.kind === 'task-notification') return false;
      if (entry.isCompactSummary) return false;
      const content = entry.message && entry.message.content;
      if (Array.isArray(content)) return false; // tool_result or similar
      return true;
    }
    let lastUserIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (isRealUserMessage(entry)) { lastUserIdx = i; break; }
      } catch {}
    }
    if (lastUserIdx === -1) return null;

    const textBlocks = [];
    for (let i = lastUserIdx + 1; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const c of entry.message.content) {
            if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
              textBlocks.push(c.text.trim());
            }
          }
        }
      } catch {}
    }

    if (textBlocks.length <= 1) return null; // No benefit over result.result
    return textBlocks.join('\n\n');
  } catch (err) {
    log(`extractFullResponseFromSession error: ${err.message}`);
    return null;
  }
}

// ============================================================
// CLAUDE CODE SUBPROCESS
// ============================================================

// Track the currently running subprocess so /stop can kill it
let activeSubprocess = null;
let activeKillFn = null; // backend-specific kill: proc.kill for claude/cron, killTree for codex
let codexExecutionOwner = null;
let codexExecutionSeq = 0;
const codexExecutionQueue = [];

function codexLockPriority(priority) {
  return priority === 'cron' ? 1 : 0;
}

function flushCodexExecutionQueue() {
  if (codexExecutionOwner || codexExecutionQueue.length === 0) return;
  codexExecutionQueue.sort((a, b) => {
    const priorityDiff = codexLockPriority(a.priority) - codexLockPriority(b.priority);
    return priorityDiff !== 0 ? priorityDiff : a.seq - b.seq;
  });
  const next = codexExecutionQueue.shift();
  codexExecutionOwner = next;
  log(`Codex execution lock acquired by ${next.label}`);
  next.resolve(() => {
    if (codexExecutionOwner === next) {
      codexExecutionOwner = null;
      log(`Codex execution lock released by ${next.label}`);
      flushCodexExecutionQueue();
    }
  });
}

function acquireCodexExecutionLock(priority, label) {
  return new Promise((resolve) => {
    codexExecutionQueue.push({
      priority,
      label,
      seq: codexExecutionSeq++,
      resolve,
    });
    flushCodexExecutionQueue();
  });
}

async function withCodexExecutionLock(priority, label, fn) {
  const release = await acquireCodexExecutionLock(priority, label);
  try {
    return await fn();
  } finally {
    release();
  }
}

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

    if (options.effort) {
      args.push('--effort', options.effort);
    }

    if (options.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    }

    // Use lightweight cron workspace for cron jobs, full workspace for user messages
    const cwd = options.isCron ? CRON_WORKSPACE : WORKSPACE;

    log(`Spawning: claude ${args.slice(0, 6).join(' ')}... (cwd: ${options.isCron ? 'cron' : 'main'})`);

    // Strip only the "nested session" detection vars, keep session auth token.
    // Inject NATIVECLAW_* so downstream wrappers (mcp-wrapper.js, keychain helpers,
    // memory tooling) resolve per-install paths without hardcoding.
    const cleanEnv = { ...process.env, ...nativeClawEnv() };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.MCP_CLAUDE;

    const proc = spawn('claude', args, {
      cwd: cwd,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeSubprocess = proc;
    activeKillFn = (sig) => proc.kill(sig);

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
      activeKillFn = null;
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

        // Try to get full response from session JSONL (captures text before tool calls)
        const sid = result.session_id || null;
        const fullText = sid ? extractFullResponseFromSession(sid) : null;
        const responseText = fullText || result.result || result.message || '';

        resolve({
          text: responseText,
          sessionId: sid,
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

// Codex thread rollover thresholds — relaxed so a single daily thread survives
// normal use. Safety valve only, not normal flow. Failure case (Apr 18 2026):
// 1.65MB / 771-entry rollout caused Codex to stall silently.
const CODEX_ROLLOVER_BYTES = 1536 * 1024;
const CODEX_ROLLOVER_ENTRIES = 250;

function findCodexRollout(threadId) {
  if (!threadId) return null;
  const root = path.join(HOME_DIR, '.codex', 'sessions');
  if (!fs.existsSync(root)) return null;
  try {
    for (const y of fs.readdirSync(root)) {
      const yp = path.join(root, y);
      if (!fs.statSync(yp).isDirectory()) continue;
      for (const m of fs.readdirSync(yp)) {
        const mp = path.join(yp, m);
        if (!fs.statSync(mp).isDirectory()) continue;
        for (const d of fs.readdirSync(mp)) {
          const dp = path.join(mp, d);
          if (!fs.statSync(dp).isDirectory()) continue;
          for (const f of fs.readdirSync(dp)) {
            if (f.endsWith(`-${threadId}.jsonl`)) return path.join(dp, f);
          }
        }
      }
    }
  } catch { /* ignore walk errors */ }
  return null;
}

function shouldRolloverCodex(threadId) {
  const filePath = findCodexRollout(threadId);
  if (!filePath) return { rollover: false, reason: 'rollout file not found', missing: true };
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > CODEX_ROLLOVER_BYTES) {
      return { rollover: true, reason: `size=${stat.size}B > ${CODEX_ROLLOVER_BYTES}B`, path: filePath };
    }
    const entries = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim()).length;
    if (entries > CODEX_ROLLOVER_ENTRIES) {
      return { rollover: true, reason: `entries=${entries} > ${CODEX_ROLLOVER_ENTRIES}`, path: filePath };
    }
    return { rollover: false, size: stat.size, entries, path: filePath };
  } catch (err) {
    return { rollover: true, reason: `stat error: ${err.message}` };
  }
}

// Reap orphan MCP processes (PPID=1) left behind when a prior codex subprocess was killed
// without taking its MCP children with it. Cheap defense in case tree-kill ever misses.
function reapOrphanMCPs() {
  try {
    const pids = execSync("pgrep -f 'mcp.*trello|playwright.*mcp|@modelcontextprotocol' 2>/dev/null || true", { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    if (pids.length > 5) {
      log(`Reaping ${pids.length} orphan MCP processes from prior codex runs`);
      execSync("pkill -f 'mcp.*trello|playwright.*mcp|@modelcontextprotocol' 2>/dev/null || true");
    }
  } catch { /* best effort */ }
}

// Codex subprocess runner. Returns the same shape as runClaude for drop-in dispatch.
// Codex emits JSONL events on stdout. In Codex CLI JSON, commentary updates and
// final answers both arrive as agent_message items with no phase marker, so only
// the last agent_message should be forwarded to Telegram.
function runCodex(prompt, threadId, options = {}) {
  return new Promise((resolve, reject) => {
    const model = options.codexModel || CODEX_DEFAULT_MODEL;
    // `codex exec resume` rejects --cd and --model (those are bound to the
    // original session). Fresh `codex exec` accepts both. Build args per-mode.
    const args = ['exec'];
    const commonFlags = ['--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'];
    const configFlags = [];
    if (options.effort) {
      // Map Claude effort levels to Codex equivalents. 'max' must become 'xhigh' —
      // Codex rejects 'max' with "Error loading config.toml: unknown variant".
      const codexEffort = CODEX_REASONING_EFFORT[options.effort] || options.effort;
      // Belt-and-suspenders: if mapping somehow missed, never send 'max' to codex
      const safeEffort = codexEffort === 'max' ? 'xhigh' : codexEffort;
      configFlags.push('-c', `model_reasoning_effort=${JSON.stringify(safeEffort)}`);
    }
    if (options.codexVerbosity) {
      configFlags.push('-c', `model_verbosity=${JSON.stringify(options.codexVerbosity)}`);
    }

    if (threadId) {
      args.push('resume', ...commonFlags, ...configFlags, threadId, prompt);
    } else {
      args.push(...commonFlags, ...configFlags, '--cd', WORKSPACE, '--model', model, prompt);
    }

    log(`Spawning: codex ${args.slice(0, 2).join(' ')} [${threadId ? 'resume' : 'fresh'}] model=${model} effort=${options.effort || 'default'} verbosity=${options.codexVerbosity || 'default'}`);

    // Defensive: clean up orphan MCPs from prior killed subprocesses before spawning
    reapOrphanMCPs();

    const cleanEnv = { ...process.env, ...nativeClawEnv() };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.MCP_CLAUDE;

    const proc = spawn('codex', args, {
      cwd: WORKSPACE,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group → tree-kill via negative PID cascades to MCP children
    });

    // Tree-kill helper: kill whole process group so MCP subprocesses don't orphan
    const killTree = (signal) => {
      try { process.kill(-proc.pid, signal); }
      catch { try { proc.kill(signal); } catch { /* gone */ } }
    };

    activeSubprocess = proc;
    activeKillFn = killTree;
    const startTime = Date.now();

    let stdout = '';
    let stderr = '';
    let lastDataAt = Date.now();

    proc.stdout.on('data', (d) => { stdout += d.toString(); lastDataAt = Date.now(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); lastDataAt = Date.now(); });

    const timeoutMs = (options.timeout || 300) * 1000;
    const idleMs = (options.idleTimeout || 180) * 1000;
    const timer = setTimeout(() => {
      log(`Codex subprocess wall-clock timeout after ${timeoutMs}ms, killing tree...`);
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 5000);
    }, timeoutMs);
    const idleTimer = setInterval(() => {
      const idleFor = Date.now() - lastDataAt;
      if (idleFor > idleMs) {
        log(`Codex subprocess idle ${Math.round(idleFor/1000)}s (no stdout/stderr; limit ${idleMs/1000}s), killing tree...`);
        clearInterval(idleTimer);
        killTree('SIGTERM');
        setTimeout(() => killTree('SIGKILL'), 5000);
      }
    }, 5000);

    proc.on('close', (code) => {
      activeSubprocess = null;
      activeKillFn = null;
      clearTimeout(timer);
      clearInterval(idleTimer);

      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(stderr.trim() || `codex exited with code ${code}`));
      }

      // Parse JSONL: one event per line
      let outThreadId = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      let turns = 0;
      let latestAgentText = '';
      let errorMsg = null;

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed);
          switch (ev.type) {
            case 'thread.started':
              outThreadId = ev.thread_id || null;
              break;
            case 'turn.started':
              turns++;
              break;
            case 'item.completed':
              if (ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') {
                latestAgentText = ev.item.text;
              }
              break;
            case 'turn.completed':
              if (ev.usage) {
                // Use = not += — resume sessions emit cumulative per-turn history;
                // last turn's usage reflects only the new response, not all prior context.
                inputTokens = ev.usage.input_tokens || 0;
                outputTokens = ev.usage.output_tokens || 0;
                cachedInputTokens = ev.usage.cached_input_tokens || 0;
              }
              break;
            case 'error':
              errorMsg = ev.message || 'unknown codex error';
              break;
          }
        } catch {
          // Not JSON, skip
        }
      }

      if (errorMsg && !latestAgentText.trim()) {
        return reject(new Error(`Codex error: ${errorMsg.slice(0, 400)}`));
      }

      resolve({
        text: latestAgentText.trim(),
        sessionId: outThreadId,
        // Subscription-billed; real $ is $0 per message. Expose tokens for /stats.
        cost: 0,
        turns: turns,
        duration: Date.now() - startTime,
        usage: { inputTokens, outputTokens, cachedInputTokens },
        isError: !!errorMsg,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      clearInterval(idleTimer);
      reject(new Error(`Failed to spawn codex: ${err.message}`));
    });
  });
}

// Dispatcher — picks the backend runner, builds backend-specific context,
// and threads through session state.
async function runBackend(backend, prompt, options, sessionKey) {
  if (backend === 'codex') {
    let threadId = getStoredSessionId('codex', sessionKey);
    let rolloverNote = null;

    // Auto-rollover: rotate to fresh thread if existing rollout is bloated.
    // Prevents the silent Codex stall observed Apr 18 2026 on a 1.65MB rollout.
    if (threadId) {
      const check = shouldRolloverCodex(threadId);
      if (check.rollover) {
        log(`Codex thread ${threadId} rollover triggered: ${check.reason}`);
        clearStoredSession('codex', sessionKey, `rollover: ${check.reason}`);
        saveState();
        threadId = null;
        rolloverNote = `[System note: Prior Codex thread was auto-rolled over to prevent stall (${check.reason}). If you need conversation history beyond this message, read today's daily log in memory/. If QMD/search_memory is configured, search it for deeper history.]`;
      } else if (check.missing) {
        log(`Codex thread ${threadId} has no rollout file yet; keeping the same-day thread and skipping rollover`);
      } else {
        log(`Codex thread ${threadId} ok: size=${check.size}B entries=${check.entries}`);
      }
    }

    const executeCodexTurn = async (activeThreadId, extraNotes = []) => {
      const contextParts = [];

      // Standing context: only injected on a FRESH Codex thread.
      // Once the thread exists, `codex exec resume` preserves conversation history
      // server-side, so we don't need to re-send 50k tokens every message.
      if (!activeThreadId) {
        const today = getCurrentSessionDay();
        const sessionStartDone = state.sessionStartRanToday === today;
        const standing = buildCodexContext({ sessionStartDone });
        if (standing) {
          contextParts.push(standing);
          log(`Fresh Codex thread: injecting standing context (${standing.length} chars, sessionStartDone=${sessionStartDone})`);
        }
        if (!sessionStartDone) {
          state.sessionStartRanToday = today;
          saveState();
        }
      }

      // Pending cross-backend transfer — one-shot on switch, goes in regardless of thread state
      if (options.transferContext) contextParts.push(options.transferContext);

      for (const note of extraNotes) {
        if (note) contextParts.push(note);
      }

      const finalPrompt = contextParts.length > 0
        ? `${contextParts.join('\n\n')}\n\n# USER MESSAGE\n\n${prompt}`
        : prompt;

      return withCodexExecutionLock(options.codexLockPriority || 'user', options.codexLockLabel || `telegram:${sessionKey}`, () =>
        runCodex(finalPrompt, activeThreadId, options)
      );
    };

    let result = await executeCodexTurn(threadId, rolloverNote ? [rolloverNote] : []);
    if (!result.text) {
      const retryReason = threadId
        ? `same-day thread ${threadId} returned no agent response`
        : 'fresh Codex turn returned no agent response';
      log(`Codex empty response for ${sessionKey}: ${retryReason}`);
      clearStoredSession('codex', sessionKey, retryReason);
      saveState();
      result = await executeCodexTurn(null, [
        '[System note: The previous Codex attempt produced no agent response. Start clean, answer the user directly, and finish the turn normally.]',
      ]);
      if (!result.text) {
        throw new Error('Codex returned no response after a fresh retry');
      }
    }

    return result;
  }

  // Claude path
  const sessionId = getStoredSessionId('claude', sessionKey);
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

function hasPendingTelegramWork() {
  return processingTelegram || telegramQueue.length > 0 || Object.keys(chatDebounceTimers).length > 0;
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
    const nextItem = cronQueue[0];
    const primaryChat = ALLOWED_CHAT_IDS[0];
    const codexCronPending = !!(nextItem && !nextItem.command && primaryChat && getBackend(primaryChat) === 'codex');
    if (codexCronPending && hasPendingTelegramWork()) {
      await sleep(1000);
      continue;
    }

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
  'opus': 'claude-opus-4-7',
  'opus4.7': 'claude-opus-4-7',
  'opus-4.7': 'claude-opus-4-7',
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

const MODEL_DISPLAY = {
  'claude-opus-4-7': 'Opus 4.7',
  'opus': 'Opus 4.6',
  'sonnet': 'Sonnet 4.6',
  'claude-sonnet-4-5-20241022': 'Sonnet 4.5',
  'haiku': 'Haiku 4.5',
};
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_VERBOSITY_LEVELS = ['low', 'medium', 'high'];
const CODEX_REASONING_EFFORT = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'xhigh',
};

function getSettings(chatId) {
  if (!chatSettings[chatId]) {
    chatSettings[chatId] = { model: null, codexModel: null, effort: 'xhigh', codexVerbosity: null, thinking: false, lastResult: null };
  }
  if (chatSettings[chatId].codexModel === undefined) {
    chatSettings[chatId].codexModel = null;
  }
  if (!chatSettings[chatId].effort) {
    chatSettings[chatId].effort = chatSettings[chatId].thinking ? 'max' : 'xhigh';
  }
  if (chatSettings[chatId].codexVerbosity === undefined) {
    chatSettings[chatId].codexVerbosity = null;
  }
  chatSettings[chatId].thinking = chatSettings[chatId].effort === 'max';
  return chatSettings[chatId];
}

// ============================================================
// USAGE QUERIES (plan / weekly / session limits)
// Anthropic: api.anthropic.com/api/oauth/usage  (Bearer from OS keychain)
// OpenAI:    chatgpt.com/backend-api/wham/usage (Bearer from ~/.codex/auth.json)
// ============================================================

async function fetchClaudeUsage() {
  try {
    let raw;
    if (process.platform === 'darwin') {
      raw = execSync('security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null', { encoding: 'utf8' }).trim();
    } else {
      // Linux: Claude credentials path; fall back to ~/.claude/.credentials.json or env
      const credPath = path.join(HOME_DIR, '.claude', '.credentials.json');
      if (fs.existsSync(credPath)) {
        raw = fs.readFileSync(credPath, 'utf8');
      } else {
        return { error: 'Claude credentials not found. Run `claude setup-token` to enable.' };
      }
    }
    const creds = JSON.parse(raw)?.claudeAiOauth || {};
    const token = creds.accessToken;
    if (!token) return { error: 'Claude credentials missing. Run `claude setup-token` to enable.' };
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-cli',
      },
    });
    if (!res.ok) return { error: `Anthropic HTTP ${res.status}` };
    const body = await res.json();
    body._subscriptionType = creds.subscriptionType || 'unknown';
    return body;
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

async function fetchCodexUsage() {
  try {
    const authPath = path.join(HOME_DIR, '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return { error: 'Codex not logged in. Run `codex login` to enable.' };
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const token = auth?.tokens?.access_token;
    const acct = auth?.tokens?.account_id;
    if (!token) return { error: 'Codex token missing. Run `codex login` to refresh.' };
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'ChatGPT-Account-ID': acct || '',
        'User-Agent': 'codex_cli_rs',
      },
    });
    if (!res.ok) return { error: `OpenAI HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

function usageBar(pct) {
  const n = Math.round(Math.max(0, Math.min(100, Number(pct) || 0)) / 10);
  return '▓'.repeat(n) + '░'.repeat(10 - n);
}

function usageResetLabel(input) {
  if (input == null) return 'unknown';
  const d = typeof input === 'number' ? new Date(input * 1000) : new Date(input);
  if (isNaN(d.getTime())) return 'unknown';
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const tz = process.env.TZ || 'America/New_York';
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const sameDay = d.toLocaleDateString('en-US', { timeZone: tz }) === now.toLocaleDateString('en-US', { timeZone: tz });
  const isTomorrow = d.toLocaleDateString('en-US', { timeZone: tz }) === tomorrow.toLocaleDateString('en-US', { timeZone: tz });
  if (sameDay) return time;
  if (isTomorrow) return `tomorrow ${time}`;
  const day = d.toLocaleString('en-US', { weekday: 'short', timeZone: tz });
  return `${day} ${time}`;
}

function formatUsageReply(claude, codex) {
  const lines = ['⚡ Usage', ''];

  // Bars show "% left" — fuel-gauge semantics: full bar = healthy, draining = burning quota.
  // Both Anthropic (utilization) and OpenAI (used_percent) report % consumed; we invert for display.

  const claudeLabel = claude.error
    ? 'Claude'
    : `Claude (${(claude._subscriptionType || 'unknown').toString().toUpperCase()})`;
  lines.push(claudeLabel);
  if (claude.error) {
    lines.push(`  ⚠️ ${claude.error}`);
  } else {
    const fh = claude.five_hour;
    const sd = claude.seven_day;
    if (fh) { const left = 100 - fh.utilization; lines.push(`  Session  ${usageBar(left)} ${left}% left   resets ${usageResetLabel(fh.resets_at)}`); }
    if (sd) { const left = 100 - sd.utilization; lines.push(`  Weekly   ${usageBar(left)} ${left}% left   resets ${usageResetLabel(sd.resets_at)}`); }
    const opus = claude.seven_day_opus;
    const sonnet = claude.seven_day_sonnet;
    if (opus && opus.utilization > 0) { const left = 100 - opus.utilization; lines.push(`  Opus 7d  ${usageBar(left)} ${left}% left`); }
    if (sonnet && sonnet.utilization > 0) { const left = 100 - sonnet.utilization; lines.push(`  Sonnet 7d ${usageBar(left)} ${left}% left`); }
  }

  lines.push('');

  const codexLabel = codex.error
    ? 'Codex'
    : `Codex (ChatGPT ${(codex.plan_type || 'unknown').toString().toUpperCase()})`;
  lines.push(codexLabel);
  if (codex.error) {
    lines.push(`  ⚠️ ${codex.error}`);
  } else {
    const rl = codex.rate_limit || {};
    const pw = rl.primary_window;
    const sw = rl.secondary_window;
    if (pw) { const left = 100 - pw.used_percent; lines.push(`  Session  ${usageBar(left)} ${left}% left   resets ${usageResetLabel(pw.reset_at)}`); }
    if (sw) { const left = 100 - sw.used_percent; lines.push(`  Weekly   ${usageBar(left)} ${left}% left   resets ${usageResetLabel(sw.reset_at)}`); }
    if (rl.limit_reached) lines.push(`  ⚠️ Rate limit reached`);
  }

  return lines.join('\n');
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
      const alias = MODEL_ALIASES[arg.toLowerCase()];
      if (!alias) {
        const available = Object.entries(MODEL_ALIASES)
          .filter(([k, v], i, arr) => arr.findIndex(([k2, v2]) => v2 === v) === i)
          .map(([k, v]) => `  ${k} → ${MODEL_DISPLAY[v] || v}`)
          .join('\n');
        return `Unknown model "${arg}". Available:\n${available}`;
      }
      settings.model = alias;
      return `Switched to ${MODEL_DISPLAY[alias] || alias}`;
    }

    case '/opus':
      settings.model = 'claude-opus-4-7';
      return 'Switched to Opus 4.7';

    case '/sonnet':
      settings.model = 'sonnet';
      return 'Switched to Sonnet 4.6';

    case '/haiku':
      settings.model = 'haiku';
      return 'Switched to Haiku 4.5';

    case '/codex': {
      // Sub-commands: /codex, /codex help, /codex <model-alias>
      const sub = arg.toLowerCase();
      if (sub === 'help' || sub === 'models') {
        const currentId = settings.codexModel || CODEX_DEFAULT_MODEL;
        const lines = Object.entries(CODEX_MODELS).map(([alias, m]) => {
          const mark = m.id === currentId ? ' ← current' : '';
          return `  /${alias} — ${m.display}${mark}`;
        });
        return [
          'Codex (GPT) models:',
          '',
          ...lines,
          '',
          `Send /codex to toggle backend. Current backend: ${getBackend(chatId).toUpperCase()}.`,
        ].join('\n');
      }
      // `/codex --full` → switch to Codex with full session gap (no time filter).
      if (sub === '--full') {
        const previousBackend = getBackend(chatId);
        const sessionKey = String(chatId);
        let transferContext = null;
        if (previousBackend === 'claude') {
          transferContext = buildGapTranscript('claude', sessionKey, null);
          if (transferContext) {
            log(`Prebuilt claude→codex full gap for ${sessionKey}: ${transferContext.length} chars`);
          } else {
            log(`No claude→codex full gap to inject for ${sessionKey} (no Claude session or no extractable events)`);
          }
        }
        setBackend(chatId, 'codex', transferContext ? { context: transferContext, mode: 'full' } : undefined);
        markBackendArrival(sessionKey, 'codex');
        const currentId = settings.codexModel || CODEX_DEFAULT_MODEL;
        return `Backend switched to CODEX (${currentId}). Full transcript replay is ready, and today's Codex thread will resume if it already exists.`;
      }
      if (sub) {
        // Allow `/codex 5.4-mini` as shortcut to switch model
        const alias = sub.replace(/^gpt-?/, '');
        if (CODEX_MODELS[alias]) {
          settings.codexModel = CODEX_MODELS[alias].id;
          return `Codex model set to ${CODEX_MODELS[alias].display}.`;
        }
        return `Unknown Codex model "${arg}". Try /codex help.`;
      }

      // Bare `/codex` → switch to Codex with gap transcript from Claude since user last arrived there.
      const previousBackend = getBackend(chatId);
      const sessionKey = String(chatId);
      let transferContext = null;
      let transferMode = null;
      if (previousBackend === 'claude') {
        const since = getBackendArrival(sessionKey, 'claude');
        transferContext = buildGapTranscript('claude', sessionKey, since);
        transferMode = 'gap';
        if (transferContext) {
          log(`Prebuilt claude→codex gap for ${sessionKey}: ${transferContext.length} chars (since=${since || 'beginning-of-session'})`);
        } else {
          log(`No claude→codex gap to inject for ${sessionKey} (since=${since || 'beginning-of-session'}; no events in window or no Claude session)`);
        }
      }
      setBackend(chatId, 'codex', transferContext ? { context: transferContext, mode: transferMode } : undefined);
      markBackendArrival(sessionKey, 'codex');
      const currentId = settings.codexModel || CODEX_DEFAULT_MODEL;
      const resumeNote = getStoredSessionId('codex', sessionKey)
        ? "Today's Codex thread will resume on your next message."
        : 'Next Codex message starts a fresh daily thread.';
      return transferContext
        ? `Backend switched to CODEX (${currentId}). Gap transcript is ready. ${resumeNote}`
        : `Backend switched to CODEX (${currentId}). No Claude gap context to inject. ${resumeNote}`;
    }

    case '/claude': {
      const sub = arg.toLowerCase();
      const previousBackend = getBackend(chatId);
      const sessionKey = String(chatId);
      let transferContext = null;
      let transferMode = null;

      if (sub && sub !== '--full') {
        return `Unknown Claude option "${arg}". Use /claude or /claude --full.`;
      }

      if (previousBackend === 'codex') {
        if (sub === '--full') {
          transferContext = buildGapTranscript('codex', sessionKey, null);
          transferMode = 'full';
          if (transferContext) {
            log(`Prebuilt codex→claude full gap for ${sessionKey}: ${transferContext.length} chars`);
          } else {
            log(`No codex→claude full gap to inject for ${sessionKey} (no Codex thread or no extractable events)`);
          }
        } else {
          const since = getBackendArrival(sessionKey, 'codex');
          transferContext = buildGapTranscript('codex', sessionKey, since);
          transferMode = 'gap';
          if (transferContext) {
            log(`Prebuilt codex→claude gap for ${sessionKey}: ${transferContext.length} chars (since=${since || 'beginning-of-thread'})`);
          } else {
            log(`No codex→claude gap to inject for ${sessionKey} (since=${since || 'beginning-of-thread'}; no events in window or no Codex thread)`);
          }
        }
      }

      setBackend(chatId, 'claude', transferContext ? { context: transferContext, mode: transferMode } : undefined);
      markBackendArrival(sessionKey, 'claude');
      const resumeNote = getStoredSessionId('claude', sessionKey)
        ? "Today's Claude session will resume on your next message."
        : 'Next Claude message starts a fresh daily session.';
      return transferContext
        ? `Backend switched to CLAUDE. Gap transcript is ready. ${resumeNote}`
        : `Backend switched to CLAUDE. ${resumeNote}`;
    }

    // Codex model shortcuts (mirror Claude's /opus /sonnet /haiku pattern)
    case '/5.5':
    case '/5.4':
    case '/5.4-mini':
    case '/5.3-codex':
    case '/5.2':
    case '/5.2-codex':
    case '/5.1-codex-max':
    case '/5.1-codex-mini': {
      const alias = cmd.slice(1);
      const m = CODEX_MODELS[alias];
      if (!m) return `Unknown Codex model "${cmd}".`;
      settings.codexModel = m.id;
      return `Codex model set to ${m.display}. ${getBackend(chatId) === 'codex' ? '' : '(Run /codex to activate Codex backend.)'}`.trim();
    }

    case '/catchup': {
      // Force the current backend to read the OTHER backend's session on the next turn.
      // Useful when a previous /codex or /claude switch lost its handoff (rate limit,
      // crash, empty session) and the current backend is missing context.
      const sessionKey = String(chatId);
      const currentBackend = getBackend(chatId);
      const otherBackend = currentBackend === 'claude' ? 'codex' : 'claude';
      let context = null;
      const since = getBackendArrival(sessionKey, otherBackend);
      context = buildGapTranscript(otherBackend, sessionKey, since);
      if (!context) return `No ${otherBackend} session found to catch up from. Source transcript is empty or unreadable.`;
      state.pendingTransfer[sessionKey] = { from: otherBackend, to: currentBackend, context, mode: 'catchup' };
      saveState();
      return `Catchup queued. Your next message on ${currentBackend} will be prefixed with the ${otherBackend} session context (${context.length} chars).`;
    }

    case '/effort': {
      const level = arg.toLowerCase();
      if (!level) {
        return `Current effort: ${settings.effort}\nUsage: /effort <${EFFORT_LEVELS.join('|')}>`;
      }
      if (!EFFORT_LEVELS.includes(level)) {
        return `Unknown effort "${arg}". Use one of: ${EFFORT_LEVELS.join(', ')}`;
      }
      settings.effort = level;
      settings.thinking = level === 'max';
      saveState();
      const codexEffort = CODEX_REASONING_EFFORT[level] || level;
      return `Effort set to ${level}. Claude uses \`--effort=${level}\`; Codex uses \`model_reasoning_effort=${codexEffort}\`.`;
    }

    case '/think':
    case '/thinking': {
      const level = arg.toLowerCase();
      if (level === 'off') {
        settings.effort = 'xhigh';
        settings.thinking = false;
        saveState();
        return 'Extended thinking: OFF (effort xhigh)';
      }
      if (level === 'on' || !level) {
        const next = settings.effort === 'max' && !level ? 'xhigh' : 'max';
        settings.effort = next;
        settings.thinking = next === 'max';
        saveState();
        return `Extended thinking: ${settings.thinking ? 'ON' : 'OFF'} (effort ${settings.effort})`;
      }
      if (EFFORT_LEVELS.includes(level)) {
        settings.effort = level;
        settings.thinking = level === 'max';
        saveState();
        return `Effort set to ${level}.`;
      }
      return `Usage: /think [on|off|${EFFORT_LEVELS.join('|')}]`;
    }

    case '/verbosity': {
      const level = arg.toLowerCase();
      if (!level) {
        return `Current Codex verbosity: ${settings.codexVerbosity || 'default'}\nUsage: /verbosity <default|${CODEX_VERBOSITY_LEVELS.join('|')}>`;
      }
      if (level === 'default' || level === 'off') {
        settings.codexVerbosity = null;
        saveState();
        return 'Codex verbosity reset to default.';
      }
      if (!CODEX_VERBOSITY_LEVELS.includes(level)) {
        return `Unknown verbosity "${arg}". Use one of: default, ${CODEX_VERBOSITY_LEVELS.join(', ')}`;
      }
      settings.codexVerbosity = level;
      saveState();
      return `Codex verbosity set to ${level} via \`model_verbosity=${level}\`.`;
    }

    case '/reset':
    case '/new':
    case '/fresh': {
      const backend = getBackend(chatId);
      if (backend === 'codex') {
        clearStoredSession('codex', sessionKey, 'manual reset');
      } else {
        clearStoredSession('claude', sessionKey, 'manual reset');
      }
      delete state.exchangeCount[sessionKey];
      saveState();
      return `${backend.toUpperCase()} session cleared. Next message starts fresh.`;
    }

    case '/usage': {
      const [claude, codex] = await Promise.all([fetchClaudeUsage(), fetchCodexUsage()]);
      return formatUsageReply(claude, codex);
    }

    case '/stats': {
      const last = settings.lastResult;
      if (!last) return 'No stats yet. Send a message first.';
      const lines = [
        `Last response stats:`,
        `  Backend: ${(last.backend || 'claude').toUpperCase()}`,
        `  Model: ${MODEL_DISPLAY[last.model] || last.model}`,
        `  Duration: ${(last.duration / 1000).toFixed(1)}s`,
        `  Turns: ${last.turns}`,
      ];
      if (last.backend === 'codex' && last.usage) {
        const inTok = last.usage.inputTokens || 0;
        const cached = last.usage.cachedInputTokens || 0;
        const outTok = last.usage.outputTokens || 0;
        const uncached = Math.max(0, inTok - cached);
        const cachedPct = inTok > 0 ? ((cached / inTok) * 100).toFixed(0) : '0';
        lines.push(`  Tokens: in ${inTok} / out ${outTok}`);
        lines.push(`  Cache: ${cached} cached (${cachedPct}%) / ${uncached} uncached`);
        if (last.turns > 1) {
          lines.push(`  ⚠️ Cumulative — Codex reports total thread tokens, not per-turn`);
        }
      } else {
        lines.push(`  Cost: $${last.cost}`);
      }
      lines.push(`  Session: ${last.sessionId || 'none'}`);
      return lines.join('\n');
    }

    case '/session': {
      const backend = getBackend(chatId);
      const sid = backend === 'codex' ? getStoredSessionId('codex', sessionKey) : getStoredSessionId('claude', sessionKey);
      return sid
        ? `${backend.toUpperCase()} session: ${sid}\nUse /reset to start fresh.`
        : `No active ${backend.toUpperCase()} session. Next message will start one.`;
    }

    case '/status': {
      const bridgePid = fs.existsSync(PID_PATH) ? fs.readFileSync(PID_PATH, 'utf8').trim() : '?';
      const cronCount = cronJobs.length;
      const backend = getBackend(chatId);
      const currentModel = backend === 'codex'
        ? (settings.codexModel || CODEX_DEFAULT_MODEL)
        : (settings.model || DEFAULT_MODEL);
      const modelDisplay = backend === 'codex'
        ? currentModel
        : (MODEL_DISPLAY[currentModel] || currentModel);
      const thinking = settings.effort === 'max' ? 'ON' : 'OFF';
      const verbosity = settings.codexVerbosity || 'default';
      const sid = backend === 'codex'
        ? (getStoredSessionId('codex', sessionKey) ? 'Active' : 'None')
        : (getStoredSessionId('claude', sessionKey) ? 'Active' : 'None');
      return [
        'NativeClaw Status:',
        `  Bridge PID: ${bridgePid}`,
        `  Backend: ${backend.toUpperCase()}`,
        `  Model: ${modelDisplay}`,
        `  Effort: ${settings.effort}`,
        `  Thinking: ${thinking}`,
        `  Codex verbosity: ${verbosity}`,
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
        '— Backend —',
        '/claude — Use Claude backend, resuming today\'s Claude session if it exists',
        '/claude --full — Use Claude with raw Codex replay',
        '/codex — Use Codex (GPT) backend, resuming today\'s Codex thread if it exists',
        '/codex --full — Use Codex with raw Claude replay',
        '/codex help — List GPT models',
        '',
        '— Claude models —',
        '/opus — Opus 4.7',
        '/opus4.6 — Opus 4.6 (legacy)',
        '/sonnet — Sonnet 4.6',
        '/haiku — Haiku 4.5',
        '/model <name> — Any Claude model',
        '',
        '— Codex models —',
        '/5.5 — GPT-5.5 (default)',
        '/5.4 — GPT-5.4',
        '/5.4-mini — GPT-5.4 Mini',
        '/5.3-codex, /5.2, /5.2-codex, /5.1-codex-max, /5.1-codex-mini',
        '',
        '— Session —',
        '/reset — Clear current backend\'s session',
        '/fresh — Alias for /reset; clear current backend session',
        '/session — Show session info',
        '/catchup — Pull context from the OTHER backend into this one (use if a handoff was lost to rate-limit or crash)',
        '/stats — Last response stats (cached %, cumulative warning)',
        '/usage — Plan usage: 5-hour + 7-day windows for Claude and Codex',
        '/effort <low|medium|high|xhigh|max> — Set Claude/Codex thinking effort',
        '/think — Alias/toggle for /effort max',
        '/verbosity <default|low|medium|high> — Set Codex answer verbosity',
        '',
        '— System —',
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

  let firstRunPromptContext = '';
  if (config.firstRunOnboarding !== false && !text.startsWith('/') && !state.firstRun[sessionKey]) {
    state.firstRun[sessionKey] = { greetedAt: new Date().toISOString() };
    saveState();
    await sendMessage(chatId, buildFirstRunWelcome());
    firstRunPromptContext = buildFirstRunPromptContext();
    log(`First-run onboarding shown for ${sessionKey}`);
  }

  // Typing indicator — repeat every 4s since Telegram's indicator expires after 5s
  tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const typingInterval = setInterval(() => {
    tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  }, 4000);

  const backend = getBackend(chatId);

  // Increment exchange counter for this session
  if (!state.exchangeCount[sessionKey]) state.exchangeCount[sessionKey] = 0;
  state.exchangeCount[sessionKey]++;

  // Build prompt — for /search, wrap with QMD instruction
  let prompt = text;
  if (firstRunPromptContext) {
    prompt = `${firstRunPromptContext}\n\n# USER MESSAGE\n\n${prompt}`;
  }
  if (text.startsWith('/search ')) {
    prompt = `Search memory using the QMD search_memory tool for: ${text.slice(8)}. Return the results.`;
  }

  // Checkpoint enforcement: inject reminder after N exchanges without a checkpoint
  if (state.exchangeCount[sessionKey] >= CHECKPOINT_THRESHOLD && state.exchangeCount[sessionKey] % CHECKPOINT_THRESHOLD === 0) {
    const today = new Date().toISOString().slice(0, 10);
    const dailyLog = path.join(MEMORY_DIR, `${today}.md`);
    let needsCheckpoint = true;
    try {
      if (fs.existsSync(dailyLog)) {
        const logStat = fs.statSync(dailyLog);
        const minutesSinceWrite = (Date.now() - logStat.mtimeMs) / (1000 * 60);
        if (minutesSinceWrite < 5) needsCheckpoint = false;
      }
    } catch {}
    if (needsCheckpoint) {
      prompt = `${prompt}\n\n[CHECKPOINT NOW — ${state.exchangeCount[sessionKey]} messages since last write]`;
      log(`Checkpoint reminder injected after ${state.exchangeCount[sessionKey]} exchanges`);
    } else {
      state.exchangeCount[sessionKey] = 0;
    }
    saveState();
  }

  // Consume any pending cross-backend transfer (set by setBackend when user ran /codex or /claude)
  const pending = state.pendingTransfer[sessionKey];
  let transferContext = null;
  if (pending && pending.to === backend) {
    if (pending.context) {
      transferContext = pending.context;
      log(`Transfer ${pending.from}→${pending.to} (${pending.mode || 'prebuilt'}) for ${sessionKey}: ${transferContext.length} chars`);
    } else if (pending.from === 'claude' && backend === 'codex') {
      const sinceClaude = getBackendArrival(sessionKey, 'claude');
      const useFullSession = settings.transferMode === 'full';
      transferContext = buildGapTranscript('claude', sessionKey, useFullSession ? null : sinceClaude);
      if (useFullSession) delete settings.transferMode;
      if (transferContext) {
        log(`Transfer claude→codex gap for ${sessionKey}: ${transferContext.length} chars (mode=${useFullSession ? 'full' : 'gap'})`);
      } else {
        log(`Transfer claude→codex gap empty for ${sessionKey} (no Claude session or no events in window)`);
      }
    } else if (pending.from === 'codex' && backend === 'claude') {
      const sinceCodex = getBackendArrival(sessionKey, 'codex');
      transferContext = buildGapTranscript('codex', sessionKey, sinceCodex);
      if (transferContext) {
        log(`Transfer codex→claude gap for ${sessionKey}: ${transferContext.length} chars`);
      } else {
        log(`Transfer codex→claude gap empty for ${sessionKey} (no Codex thread or no events in window)`);
      }
    }
    delete state.pendingTransfer[sessionKey];
    saveState();
  }

  // Backend-specific options
  const claudeModel = settings.model || DEFAULT_MODEL;
  const codexModel = settings.codexModel || CODEX_DEFAULT_MODEL;
  const effort = settings.effort || 'xhigh';
  const codexVerbosity = settings.codexVerbosity || null;

  // Claude: inject primer on fresh sessions AND/OR transfer context on codex→claude switch
  let appendSystemPrompt = null;
  if (backend === 'claude') {
    const parts = [];
    if (!getStoredSessionId('claude', sessionKey)) {
      const today = getCurrentSessionDay();
      const sessionStartDone = state.sessionStartRanToday === today;
      const primer = buildSessionPrimer({ sessionStartDone });
      if (primer) {
        parts.push(primer);
        log(`Fresh Claude session for ${sessionKey}: injecting primer (${primer.length} chars, sessionStartDone=${sessionStartDone})`);
      }
      if (!sessionStartDone) {
        state.sessionStartRanToday = today;
        saveState();
      }
    }
    if (transferContext) parts.push(transferContext);
    if (parts.length > 0) appendSystemPrompt = parts.join('\n\n');
    // For Claude backend, transferContext is consumed via appendSystemPrompt only,
    // not via runBackend's options.transferContext (which is codex-path only).
    transferContext = null;
  }

  try {
    const result = await runBackend(backend, prompt, {
      timeout: 7200,
      model: claudeModel,
      codexModel: codexModel,
      effort: effort,
      codexVerbosity: codexVerbosity,
      appendSystemPrompt: appendSystemPrompt,
      transferContext: transferContext,
    }, sessionKey);

    clearInterval(typingInterval);

    // Save stats for /stats command
    settings.lastResult = {
      backend: backend,
      model: backend === 'codex' ? codexModel : claudeModel,
      duration: result.duration || 0,
      turns: result.turns,
      cost: result.cost,
      usage: result.usage,
      sessionId: result.sessionId,
    };

    if (result.text) {
      // Persist session ID on the correct backend's slot only after we have
      // a real assistant message for the user.
      if (result.sessionId) {
        if (backend === 'codex') {
          setStoredSessionId('codex', sessionKey, result.sessionId);
        } else {
          setStoredSessionId('claude', sessionKey, result.sessionId);
        }
        saveState();
      }
      const sendResult = await sendMessage(chatId, result.text);
      const costStr = backend === 'codex'
        ? `tokens in=${result.usage?.inputTokens || 0}/out=${result.usage?.outputTokens || 0}`
        : `$${result.cost}`;
      if (sendResult.failed > 0) {
        log(`PARTIAL REPLY to ${name} [${backend}]: ${sendResult.sent}/${sendResult.total} chunks sent, ${sendResult.failed} FAILED. ${result.text.length} chars, ${result.turns} turns, ${costStr}`);
      } else {
        log(`Replied to ${name} [${backend}]: ${result.text.length} chars, ${result.turns} turns, ${costStr}`);
      }
    } else {
      throw new Error(`${backend.toUpperCase()} returned no response`);
    }

    if (_imagePath) {
      try { fs.unlinkSync(_imagePath); } catch {}
    }
  } catch (err) {
    clearInterval(typingInterval);
    log(`ERROR responding to ${name} [${backend}]: ${err.message}`);
    const errMsg = err.message.toLowerCase();
    const isRateLimit = errMsg.includes('rate limit') || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('overloaded');
    const rateLimitHint = (isRateLimit && backend === 'claude')
      ? '\n\nClaude is rate-limited. Run /codex to switch to the Codex backend.'
      : '';
    await sendMessage(chatId, `Something went wrong: ${err.message.slice(0, 200)}${rateLimitHint}`);

    // If session/thread is broken, clear the active backend's session so next message starts fresh
    if (err.message.includes('session') || err.message.includes('resume') || err.message.includes('thread') || err.message.includes('no response')) {
      if (backend === 'codex') {
        clearStoredSession('codex', sessionKey, err.message);
      } else {
        clearStoredSession('claude', sessionKey, err.message);
      }
      saveState();
      log(`Cleared broken ${backend} session for ${sessionKey}`);
    }

    if (_imagePath) {
      try { fs.unlinkSync(_imagePath); } catch {}
    }
  }
}

// ============================================================
// CRON HANDLER
// ============================================================

function runCronCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    if (!command || typeof command !== 'string') {
      return reject(new Error('cron command is missing'));
    }

    log(`Spawning cron command: ${command}`);

    const cleanEnv = { ...process.env, ...nativeClawEnv() };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.MCP_CLAUDE;

    const proc = spawn('/bin/bash', ['-lc', command], {
      cwd: WORKSPACE,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeSubprocess = proc;
    activeKillFn = (sig) => proc.kill(sig);
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeoutMs = (options.timeout || 300) * 1000;
    const timer = setTimeout(() => {
      log(`Cron command timed out after ${timeoutMs}ms, killing...`);
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      activeSubprocess = null;
      activeKillFn = null;
      clearTimeout(timer);

      const text = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      if (code !== 0) {
        return reject(new Error(text || `command exited with code ${code}`));
      }

      resolve({
        text,
        sessionId: null,
        cost: 0,
        turns: 0,
        duration: Date.now() - startTime,
        isError: false,
      });
    });

    proc.on('error', (err) => {
      activeSubprocess = null;
      activeKillFn = null;
      clearTimeout(timer);
      reject(new Error(`Failed to spawn cron command: ${err.message}`));
    });
  });
}

async function handleCronJob(item) {
  const { name, prompt, timeout, model, command } = item;

  log(`Cron firing: ${name}`);
  const startTime = Date.now();

  // Crons don't belong to a chat, so we tie them to the primary chat's backend.
  // If the user toggled /codex in their Telegram chat, crons run on Codex too.
  const primaryChat = ALLOWED_CHAT_IDS[0];
  const cronBackend = primaryChat ? getBackend(primaryChat) : 'claude';

  try {
    let result;
    if (command) {
      result = await runCronCommand(command, { timeout: timeout || 300 });
    } else if (!prompt) {
      throw new Error(`Cron "${name}" has neither prompt nor command`);
    } else if (cronBackend === 'codex') {
      // Codex cron jobs start fresh; keep the injected context lean and let
      // the prompt/tooling read specific memory files only when needed.
      const finalPrompt = `${buildCodexCronContext()}\n\n# CRON TASK\n\n${prompt}`;
      // Crons always run fresh — no resume, pass null threadId.
      const codexChatSettings = primaryChat ? getSettings(primaryChat) : {};
      result = await withCodexExecutionLock('cron', `cron:${name}`, () =>
        runCodex(finalPrompt, null, {
          timeout: timeout || 300,
          codexModel: codexChatSettings.codexModel || CODEX_DEFAULT_MODEL,
          effort: codexChatSettings.effort || 'xhigh',
          codexVerbosity: codexChatSettings.codexVerbosity || null,
        })
      );
    } else {
      result = await runClaude(prompt, null, {
        timeout: timeout || 300,
        model: model || DEFAULT_MODEL,
        effort: 'xhigh',
        maxTurns: 100,
        isCron: true,
      });
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const costStr = command
      ? 'command'
      : cronBackend === 'codex'
      ? `tokens in=${result.usage?.inputTokens || 0}/out=${result.usage?.outputTokens || 0}`
      : `$${result.cost}`;
    log(`Cron ${name} [${command ? 'command' : cronBackend}] completed: ${duration}s, ${result.turns} turns, ${costStr}`);

    // After session-audit completes, mechanically clear the active backend's session.
    // Don't rely on the LLM to do this — it's too unreliable.
    if (name === 'session-audit') {
      for (const key of Object.keys(state.sessions)) {
        if (state.sessions[key]) {
          log(`Session-audit: clearing Claude session ${state.sessions[key]} for chat ${key}`);
          clearStoredSession('claude', key);
          state.exchangeCount[key] = 0;
        }
      }
      for (const key of Object.keys(state.codexSessions)) {
        if (state.codexSessions[key]) {
          log(`Session-audit: clearing Codex thread ${state.codexSessions[key]} for chat ${key}`);
          clearStoredSession('codex', key);
        }
      }
      saveState();
    }

    // Cron prompts handle their own Telegram delivery via telegram_direct.sh
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

    const jobName = job.name || job.id;
    const fireKey = `${jobName}:${minuteKey}`;
    if (lastFired[fireKey]) continue;
    lastFired[fireKey] = true;

    log(`Cron matched: ${jobName} (${job.schedule})`);
    enqueueCron({
      name: jobName,
      prompt: job.prompt,
      command: job.command,
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
        if (activeSubprocess && activeKillFn) {
          log(`/stop received — killing active subprocess (PID ${activeSubprocess.pid})`);
          const killFn = activeKillFn; // capture before close event nulls it
          killFn('SIGTERM');
          setTimeout(() => killFn('SIGKILL'), 5000);
          // Clear the message queue so queued messages don't fire after stop
          telegramQueue.length = 0;
          await sendMessage(chatId, 'Stopped. Task killed and queue cleared.');
        } else {
          await sendMessage(chatId, 'Nothing running to stop.');
        }
        continue;
      }

      // Handle /restart — send confirmation then exit with code 1 so launchd restarts us
      if (msg.text && msg.text.trim().toLowerCase() === '/restart') {
        log('/restart received — restarting service...');
        await sendMessage(chatId, "Restarting... I'll be back in a few seconds.");
        state.pendingRestartConfirm = { chatId, ts: Date.now() };
        saveState();
        process.exit(1);
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
        const imageTypes = ['image/']; // image/jpeg, image/png, image/heic, image/heif, image/webp, etc.
        const imageExtFallback = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|svg)$/i;
        const fileTypes = [
          // PDFs
          'application/pdf',
          // Microsoft Office
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
          'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
          'application/msword', // doc
          'application/vnd.ms-excel', // xls
          'application/vnd.ms-powerpoint', // ppt
          // OpenDocument (LibreOffice)
          'application/vnd.oasis.opendocument.text', // odt
          'application/vnd.oasis.opendocument.spreadsheet', // ods
          'application/vnd.oasis.opendocument.presentation', // odp
          // Rich text + plain
          'application/rtf',
          'text/rtf',
          'text/plain',
          'text/csv',
          'text/markdown',
          'text/x-markdown',
          // Structured / config
          'application/json',
          'application/xml',
          'text/xml',
          'text/html',
          'application/x-yaml',
          'application/yaml',
          'text/yaml',
          'text/x-yaml',
          'application/toml',
          // E-books
          'application/epub+zip',
          // Email
          'message/rfc822',
          'application/vnd.ms-outlook', // .msg
          // LaTeX / academic
          'application/x-tex',
          'text/x-tex',
          // Jupyter
          'application/x-ipynb+json',
        ];
        const fileExtFallback = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|tsv|md|markdown|json|xml|ya?ml|toml|html?|epub|eml|msg|tex|ipynb|log)$/i;

        const isImage = imageTypes.some(t => mime.startsWith(t)) || imageExtFallback.test(fileName);
        const isFile = fileTypes.some(t => mime === t) || fileExtFallback.test(fileName);

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
          await sendMessage(chatId, `${mime || 'Unknown'} file type not supported. Supported: images (incl. HEIC), PDF, Office (docx/xlsx/pptx + legacy), OpenDocument (odt/ods/odp), RTF, plain text, CSV, Markdown, JSON, XML, YAML, TOML, HTML, EPUB, EML, LaTeX, Jupyter.`);
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
    // Persist chatSettings alongside state (strip ephemeral lastResult)
    const persistSettings = {};
    for (const [cid, s] of Object.entries(chatSettings)) {
      const { lastResult, ...rest } = s;
      if (Object.keys(rest).length > 0) persistSettings[cid] = rest;
    }
    const toSave = { ...state, chatSettings: persistSettings };
    fs.writeFileSync(STATE_PATH, JSON.stringify(toSave, null, 2));
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
  log('========================================');
  log('Telegram Bridge starting');
  log(`Workspace: ${WORKSPACE}`);
  log(`MCP Config: ${MCP_CONFIG}`);
  log(`Allowed chats: ${ALLOWED_CHAT_IDS.join(', ')}`);
  log(`Model: ${DEFAULT_MODEL}`);
  log('========================================');

  // Verify claude is available
  try {
    const { execSync } = require('child_process');
    const version = execSync('claude --version 2>/dev/null || echo "unknown"').toString().trim();
    log(`Claude Code version: ${version}`);
  } catch {
    log('WARNING: Could not detect Claude Code version');
  }

  // Validate bot token (with retry for cold-boot network races)
  // Auth-shaped errors (401/403) bail immediately; transient fetch/network errors retry with backoff.
  // Total retry window: ~92s — covers Wi-Fi handshake delay after a cold boot.
  const TOKEN_VERIFY_BACKOFFS_MS = [2000, 5000, 10000, 15000, 30000, 30000];
  let me = null;
  for (let attempt = 1; attempt <= TOKEN_VERIFY_BACKOFFS_MS.length + 1; attempt++) {
    try {
      me = await tg('getMe');
      break;
    } catch (err) {
      const msg = err && (err.message || String(err));
      const isAuthError = /\b(401|403|Unauthorized|Forbidden|invalid token)\b/i.test(msg || '');
      if (isAuthError) {
        log(`FATAL: Bot token rejected by Telegram: ${msg}`);
        process.exit(1);
      }
      const delay = TOKEN_VERIFY_BACKOFFS_MS[attempt - 1];
      if (delay === undefined) {
        log(`FATAL: getMe failed after ${attempt} attempts (network never recovered): ${msg}`);
        process.exit(1);
      }
      log(`getMe attempt ${attempt} failed (${msg}). Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  log(`Bot: @${me.username} (${me.first_name})`);

  // Post-restart confirmation — let the user know the bridge is back up
  if (state.pendingRestartConfirm && state.pendingRestartConfirm.chatId) {
    const { chatId: rChatId, ts } = state.pendingRestartConfirm;
    const downSec = ts ? Math.round((Date.now() - ts) / 1000) : null;
    const msg = downSec !== null
      ? `Back up. Down ${downSec}s.`
      : 'Back up.';
    try {
      await sendMessage(rChatId, msg);
      log(`Sent post-restart confirmation to ${rChatId} (down ${downSec}s)`);
    } catch (err) {
      log(`Failed to send post-restart confirmation: ${err.message}`);
    }
    delete state.pendingRestartConfirm;
    saveState();
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
  // Exit with code 1 so launchd KeepAlive restarts us
  process.exit(1);
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
