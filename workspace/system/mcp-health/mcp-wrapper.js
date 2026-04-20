#!/usr/bin/env node
// mcp-wrapper.js -- stdio supervisor for an MCP server.
// Respawns the child on crash, replays the cached initialize + initialized
// so CLI sessions survive MCP process death. Trips a circuit breaker after
// 5 restarts in 5 minutes and exits.
//
// Usage: mcp-wrapper.js [--keychain-env KEY1,KEY2,...] <mcp-name> <real-cmd> [args...]
// With --keychain-env, looks up each KEY in the macOS login keychain
// (account from NATIVECLAW_KEYCHAIN_ACCOUNT env, service "<KEY>") and injects into the child process env.

const KEYCHAIN_ACCOUNT = process.env.NATIVECLAW_KEYCHAIN_ACCOUNT || process.env.USER || 'nativeclaw';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const argv = process.argv.slice(2);
let keychainKeys = [];
while (argv[0] && argv[0].startsWith('--')) {
  const flag = argv.shift();
  if (flag === '--keychain-env') {
    keychainKeys = (argv.shift() || '').split(',').map(s => s.trim()).filter(Boolean);
  } else {
    process.stderr.write(`unknown flag: ${flag}\n`);
    process.exit(2);
  }
}
const MCP_NAME = argv[0];
const REAL_CMD = argv[1];
const REAL_ARGS = argv.slice(2);

if (!MCP_NAME || !REAL_CMD) {
  process.stderr.write('Usage: mcp-wrapper.js [--keychain-env K1,K2,...] <mcp-name> <real-cmd> [args...]\n');
  process.exit(2);
}

function fetchSecretMac(key) {
  return execFileSync('/usr/bin/security', [
    'find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', key, '-w'
  ], { encoding: 'utf8' }).trim();
}

function fetchSecretLinux(key) {
  return execFileSync('secret-tool', [
    'lookup', 'service', key, 'account', KEYCHAIN_ACCOUNT
  ], { encoding: 'utf8' }).trim();
}

function loadKeychainEnv() {
  const env = { ...process.env };
  const platform = process.platform;
  const fetcher = platform === 'darwin' ? fetchSecretMac
                : platform === 'linux'  ? fetchSecretLinux
                : null;
  if (!fetcher) {
    process.stderr.write(`keychain unsupported on platform=${platform}; falling back to process.env\n`);
    return env;
  }
  for (const key of keychainKeys) {
    try {
      const val = fetcher(key);
      if (val) env[key] = val;
    } catch (err) {
      process.stderr.write(`keychain lookup failed for ${key} (platform=${platform}): ${err.message}\n`);
    }
  }
  return env;
}

const LOG_PATH = path.join(os.homedir(), '.claude', 'logs', 'mcp-wrapper.log');
const REPLAY_INIT_ID = '__wrapper_init_replay__';
const CIRCUIT_WINDOW_MS = 5 * 60 * 1000;
const CIRCUIT_LIMIT = 5;
const BACKOFF_MS = 1000;

function log(event, data = {}) {
  try {
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({ ts: new Date().toISOString(), wrapper: MCP_NAME, event, ...data }) + '\n'
    );
  } catch (_) {}
}

let child = null;
let cachedInit = null;           // raw stdin line of first initialize request
let cachedInitialized = null;    // raw stdin line of notifications/initialized
const pending = new Map();       // id -> raw request line
const restarts = [];             // timestamps of child exits
let awaitingReplayResponse = false;

function circuitTripped() {
  const cutoff = Date.now() - CIRCUIT_WINDOW_MS;
  while (restarts.length && restarts[0] < cutoff) restarts.shift();
  return restarts.length >= CIRCUIT_LIMIT;
}

function emitErrorForPending(reason) {
  for (const id of pending.keys()) {
    const resp = {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: `MCP ${MCP_NAME} unavailable: ${reason}` }
    };
    process.stdout.write(JSON.stringify(resp) + '\n');
  }
  pending.clear();
}

function spawnChild() {
  if (circuitTripped()) {
    log('circuit-breaker-tripped', { restartsInWindow: restarts.length });
    emitErrorForPending('circuit breaker tripped (too many crashes)');
    process.exit(1);
  }

  const childEnv = keychainKeys.length ? loadKeychainEnv() : process.env;
  log('spawn', { cmd: REAL_CMD, args: REAL_ARGS, keychainKeys });
  child = spawn(REAL_CMD, REAL_ARGS, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); }
    catch {
      process.stdout.write(line + '\n');
      return;
    }
    if (awaitingReplayResponse && msg.id === REPLAY_INIT_ID) {
      awaitingReplayResponse = false;
      log('init-replay-confirmed');
      return;
    }
    if (msg.id !== undefined) pending.delete(msg.id);
    process.stdout.write(line + '\n');
  });

  child.on('exit', (code, signal) => {
    log('child-exit', { code, signal });
    restarts.push(Date.now());

    if (cachedInit) {
      emitErrorForPending(`child exited (code=${code}, signal=${signal})`);
      setTimeout(() => {
        spawnChild();
        replayInit();
      }, BACKOFF_MS);
    } else {
      emitErrorForPending('child exited before initialize');
      process.exit(code ?? 1);
    }
  });

  child.on('error', (err) => {
    log('child-error', { error: err.message });
  });
}

function replayInit() {
  if (!cachedInit || !child) return;
  try {
    const initMsg = JSON.parse(cachedInit);
    initMsg.id = REPLAY_INIT_ID;
    awaitingReplayResponse = true;
    child.stdin.write(JSON.stringify(initMsg) + '\n');
    if (cachedInitialized) {
      child.stdin.write(cachedInitialized + '\n');
    }
    log('init-replayed');
  } catch (err) {
    log('init-replay-failed', { error: err.message });
  }
}

const stdinRl = readline.createInterface({ input: process.stdin });
stdinRl.on('line', (line) => {
  if (!line.trim()) return;

  let msg;
  try { msg = JSON.parse(line); }
  catch {
    if (child && child.stdin.writable) child.stdin.write(line + '\n');
    return;
  }

  if (msg.method === 'initialize' && !cachedInit) {
    cachedInit = line;
    log('init-cached');
  }
  if (msg.method === 'notifications/initialized' && !cachedInitialized) {
    cachedInitialized = line;
    log('initialized-cached');
  }
  if (msg.id !== undefined && msg.method) {
    pending.set(msg.id, line);
  }

  if (child && child.stdin.writable) {
    child.stdin.write(line + '\n');
  }
});

stdinRl.on('close', () => {
  log('stdin-closed');
  if (child) child.kill();
  process.exit(0);
});

process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { if (child) child.kill('SIGINT'); process.exit(0); });

log('wrapper-start', { mcp: MCP_NAME, cmd: REAL_CMD, args: REAL_ARGS });
spawnChild();
