#!/usr/bin/env node
// session-self-audit.js -- supplement to the 5:10 AM session-audit cron.
// Scans the most recent Claude transcript for this workspace and flags:
//   1. Assistant commitments ("I'll X", "I'll queue") not matched by a
//      reminder, HQ activity, or daily-log checkpoint within the last 2h
//   2. User corrections ("don't", "stop doing", "next time", "never")
//      not matched by a feedback/*.md modification within the last 2h
//   3. Durable-sounding facts ($X pricing, client status changes, deadlines)
//      stated in assistant text but not present in MEMORY.md or today's log
//   4. Stale checkpoint: session exchange count since last "## Checkpoint"
//      in today's daily log (triggers at 10+ per AGENTS.md)
//
// Heuristic — false positives expected. Writes findings to
// ~/.claude/logs/self-audit.log. Exits 0 always; cron can surface on
// severity threshold if desired.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const WORKSPACE = process.env.NATIVECLAW_WORKSPACE || path.join(HOME, '.claude/workspace');
const LOG = path.join(HOME, '.claude/logs/self-audit.log');
// Derive Claude Code transcript dir from workspace path (convention: replace / and . with -)
function deriveProjectSlug(p) {
  return p.replace(/[\/.]/g, '-');
}
const PROJECT_DIR = process.env.NATIVECLAW_PROJECT_DIR
  || path.join(HOME, '.claude/projects', deriveProjectSlug(WORKSPACE));
const WINDOW_MS = 2 * 60 * 60 * 1000;           // how far back we consider
const LOOKBACK_MSGS = 80;                       // last N messages to scan

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line + "\n");
  } catch (_) {}
}

function latestTranscript() {
  let files;
  try { files = fs.readdirSync(PROJECT_DIR); } catch { return null; }
  const jsonl = files.filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f, m: fs.statSync(path.join(PROJECT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return jsonl[0] ? path.join(PROJECT_DIR, jsonl[0].f) : null;
}

function parseJsonlTail(file, n) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  return lines.slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c && c.type === 'text').map(c => c.text || '').join('\n');
  }
  return '';
}

function msgTsMs(m) { return m.timestamp ? Date.parse(m.timestamp) : 0; }

// Patterns. Kept conservative to limit noise.
const COMMITMENT_RE = /\b(I(?:'ll| will)\s+(?:queue|remind|log|add|save|schedule|create|set|reach|follow|circle|track)|I'll\s+(?:keep|stay|check|monitor|watch))\b/i;
const CORRECTION_RE = /\b(don'?t\s+\w+|stop\s+(?:doing|saying)|next time\b|never\s+(?:do|say|commit|push)|that'?s\s+wrong|fix that|not how|wrong approach)\b/i;
const DURABLE_MARKERS = [
  /\$\d{2,}(?:\/mo|\/month|\s*(?:retainer|deposit|upfront))/i,      // pricing
  /(?:signed|closed|pitched|proposal|retainer)\s+(?:with|for|to)\s+[A-Z]/,
  /(?:deadline|due|by)\s+(?:April|May|June|July|Aug|Sept|Oct|Nov|Dec|Jan|Feb|Mar|\d{1,2}\/\d{1,2})/i,
];

function fileMtimeOrZero(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

function anyFeedbackModified(sinceMs) {
  const dir = path.join(WORKSPACE, 'feedback');
  try {
    return fs.readdirSync(dir).some(f => f.endsWith('.md') && fileMtimeOrZero(path.join(dir, f)) > sinceMs);
  } catch { return false; }
}

function todayLogPath() {
  // Daily logs are keyed to local date (system timezone), not UTC.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(WORKSPACE, 'memory', `${y}-${m}-${day}.md`);
}

function lastCheckpointMs() {
  const p = todayLogPath();
  try { return fileMtimeOrZero(p); } catch { return 0; }
}

function countCheckpointsInFile(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8');
    return (txt.match(/^##\s+Checkpoint/gmi) || []).length;
  } catch { return 0; }
}

// ---- main ----
const iso = new Date().toISOString();
const nowMs = Date.now();
const windowStart = nowMs - WINDOW_MS;
const file = latestTranscript();
const findings = { commitments: [], corrections: [], durable: [], checkpoint_stale: false };

if (!file) {
  log(`${iso} session-self-audit NOFILE workspace=${WORKSPACE}`);
  process.exit(0);
}

const rows = parseJsonlTail(file, LOOKBACK_MSGS);
if (rows.length === 0) {
  log(`${iso} session-self-audit EMPTY file=${path.basename(file)}`);
  process.exit(0);
}

// Find the most-recent row that has a timestamp. Transcript interleaves
// metadata rows (queue-operation, last-prompt) that lack `timestamp`; skip those.
let lastTs = 0;
for (let i = rows.length - 1; i >= 0; i--) {
  const t = msgTsMs(rows[i]);
  if (t > 0) { lastTs = t; break; }
}
if (lastTs === 0 || nowMs - lastTs > WINDOW_MS) {
  const stamp = lastTs ? new Date(lastTs).toISOString() : 'none';
  log(`${iso} session-self-audit STALE file=${path.basename(file)} last=${stamp}`);
  process.exit(0);
}

// Count exchanges in window
let userExchanges = 0;
for (const r of rows) {
  const ts = msgTsMs(r);
  if (ts < windowStart) continue;
  if (r.type === 'user' && r.message && r.message.role === 'user') userExchanges++;
}

// Checkpoint freshness: compare # of "## Checkpoint" entries in today's log vs exchanges
const cpCount = countCheckpointsInFile(todayLogPath());
findings.checkpoint_stale = userExchanges >= 10 && (nowMs - lastCheckpointMs()) > 90 * 60 * 1000;

// Scan each message for commitments/corrections/durable facts
for (const r of rows) {
  const ts = msgTsMs(r);
  if (ts < windowStart) continue;
  const txt = extractText(r.message && r.message.content);
  if (!txt) continue;
  if (r.type === 'assistant') {
    for (const line of txt.split(/\n+/)) {
      if (COMMITMENT_RE.test(line) && line.length < 300) findings.commitments.push(line.trim().slice(0, 200));
      for (const re of DURABLE_MARKERS) if (re.test(line) && line.length < 300) findings.durable.push(line.trim().slice(0, 200));
    }
  }
  if (r.type === 'user' && r.message && r.message.role === 'user') {
    for (const line of txt.split(/\n+/)) {
      if (CORRECTION_RE.test(line) && line.length < 300) findings.corrections.push(line.trim().slice(0, 200));
    }
  }
}

// Reduce corrections: only flag if no feedback file was modified in window
const correctionsFlagged = findings.corrections.length > 0 && !anyFeedbackModified(windowStart);

// Report
const summary = {
  ts: iso,
  transcript: path.basename(file),
  window_hours: WINDOW_MS / 3600000,
  user_exchanges: userExchanges,
  checkpoint_count_today: cpCount,
  checkpoint_stale: findings.checkpoint_stale,
  commitments_detected: findings.commitments.length,
  corrections_detected: findings.corrections.length,
  corrections_unmatched: correctionsFlagged,
  durable_facts_detected: findings.durable.length,
};

const severity = (findings.checkpoint_stale || correctionsFlagged) ? 'WARN' : 'OK';
log(`${iso} session-self-audit ${severity} ${JSON.stringify(summary)}`);

// Print first 3 examples of each to log for context (truncated)
if (findings.commitments.length) {
  findings.commitments.slice(0, 3).forEach((c, i) => log(`${iso}   commitment[${i}]: ${c}`));
}
if (correctionsFlagged) {
  findings.corrections.slice(0, 3).forEach((c, i) => log(`${iso}   correction-unlogged[${i}]: ${c}`));
}
if (findings.durable.length) {
  findings.durable.slice(0, 3).forEach((c, i) => log(`${iso}   durable-fact[${i}]: ${c}`));
}

process.exit(0);
