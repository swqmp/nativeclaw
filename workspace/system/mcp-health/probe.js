#!/usr/bin/env node
// MCP pre-flight spawn/init probe.
// For each critical + important MCP from mcp-criticality.json, spawns the
// configured command, sends JSON-RPC `initialize`, waits for a valid response,
// kills the subprocess. Records per-server status to last-probe.json.
//
// Why this exists: Claude/Codex CLIs spawn MCPs per-invocation. If an MCP's
// spawn config is broken (missing binary, bad env var, upstream API down at
// init time), the first tool call in a session discovers it. This probe
// surfaces the same failure before the session starts and without wasting
// a turn.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.NATIVECLAW_WORKSPACE || path.join(require('os').homedir(), '.claude', 'workspace');
const MCP_JSON = path.join(ROOT, '.mcp.json');
const CRIT_JSON = path.join(ROOT, 'system/mcp-health/mcp-criticality.json');
const LAST_PROBE = path.join(ROOT, 'system/mcp-health/last-probe.json');
const LOG = path.join(process.env.HOME, '.claude/logs/mcp-health.log');

const TIMEOUT_MS = 10000;
const CONCURRENCY = 4;
const TIERS_TO_PROBE = new Set(['critical', 'important']);

function probeServer(name, cfg) {
  return new Promise(resolve => {
    const start = Date.now();
    const env = { ...process.env, ...(cfg.env || {}) };
    let child;
    try {
      child = spawn(cfg.command, cfg.args || [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ name, status: 'spawn_error', detail: err.message, elapsed_ms: Date.now() - start });
    }

    let buf = '';
    let done = false;

    const finish = (status, detail) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 500).unref();
      resolve({ name, status, detail, elapsed_ms: Date.now() - start });
    };

    const timer = setTimeout(() => finish('timeout', `no init response in ${TIMEOUT_MS}ms`), TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            const info = msg.result.serverInfo || {};
            finish('ok', `${info.name || '?'} v${info.version || '?'}`);
            return;
          }
          if (msg.id === 1 && msg.error) {
            finish('error', (msg.error.message || 'unknown').slice(0, 120));
            return;
          }
        } catch { /* partial JSON */ }
      }
    });

    child.on('error', err => finish('spawn_error', err.message));
    child.on('exit', (code, sig) => {
      if (!done) finish('exited', `code=${code} sig=${sig}`);
    });

    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'mcp-probe', version: '0.1' },
        capabilities: {}
      }
    }) + '\n';
    try { child.stdin.write(initMsg); } catch (err) {
      finish('stdin_error', err.message);
    }
  });
}

async function runBatched(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  const mcp = JSON.parse(fs.readFileSync(MCP_JSON, 'utf8'));
  const crit = JSON.parse(fs.readFileSync(CRIT_JSON, 'utf8'));

  const toProbe = Object.entries(mcp.mcpServers || {})
    .filter(([name]) => TIERS_TO_PROBE.has((crit.servers[name] || {}).tier));

  console.log(`Probing ${toProbe.length} MCPs (critical + important)...`);
  const results = await runBatched(toProbe, CONCURRENCY, ([name, cfg]) => probeServer(name, cfg));

  const probedAt = new Date().toISOString();
  const output = {
    probed_at: probedAt,
    timeout_ms: TIMEOUT_MS,
    tiers_probed: Array.from(TIERS_TO_PROBE),
    servers: Object.fromEntries(results.map(r => [r.name, {
      status: r.status,
      detail: r.detail,
      elapsed_ms: r.elapsed_ms,
      tier: (crit.servers[r.name] || {}).tier || 'unmapped'
    }]))
  };

  fs.writeFileSync(LAST_PROBE, JSON.stringify(output, null, 2));

  const summary = results.map(r => `${r.name}:${r.status}`).join(' ');
  try { fs.appendFileSync(LOG, `${probedAt} ${summary}\n`); } catch {}

  const byStatus = {};
  const criticalFailures = [];
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.status !== 'ok' && (crit.servers[r.name] || {}).tier === 'critical') {
      criticalFailures.push(r);
    }
  }
  console.log('Status counts:', byStatus);
  for (const r of results.filter(r => r.status !== 'ok')) {
    console.log(`  [${(crit.servers[r.name] || {}).tier}] ${r.name}: ${r.status} — ${r.detail}`);
  }

  process.exit(criticalFailures.length ? 2 : 0);
}

main().catch(err => { console.error('probe error:', err); process.exit(1); });
