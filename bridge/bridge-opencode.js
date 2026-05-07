// bridge-opencode.js — staged OpenCode subprocess runner for the kimi/grok lanes.
//
// This file is NOT YET WIRED INTO bridge.js. It is staged here for review and
// dropped into the live bridge during Phase E cutover (see PLAN.md).
//
// Drop-in shape: runOpenCode(prompt, sessionId, options) -> Promise<{
//   text, sessionId, cost, turns, duration, usage, isError
// }>
// Same output shape as runCodex() in bridge.js, so runBackend() can route
// kimi/grok through this with no changes to downstream Telegram-reply code.
//
// Key differences from runCodex:
//   - Spawns `opencode run --format json` instead of `codex exec --json`
//   - Different JSON event schema: step_start, reasoning, text, step_finish
//   - Session resume via `--session <id>` instead of `codex exec resume <id>`
//   - Reasoning effort via `--variant high|max|minimal` instead of -c flags
//   - OPENCODE_CONFIG env var points at our staged opencode.json (with MCPs)
//   - Reasoning event arrives buffered at end of reasoning phase — same idle-
//     timeout risk class as Codex; bridge MUST keep the 900s idle bump for
//     kimi/grok to survive xhigh-effort reasoning windows.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OPENCODE_BIN = process.env.OPENCODE_BIN || 'opencode';
const OPENCODE_CONFIG_PATH = process.env.OPENCODE_CONFIG ||
  path.join(process.env.HOME, '.claude/workspace/projects/opencode-migration/opencode.json');

// Map bridge-effort levels to OpenCode --variant values.
// Bridge accepts: low, medium, high, xhigh, max
// OpenCode --variant accepts: minimal, low, medium, high, max (provider-specific)
const OPENCODE_VARIANT = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'max',     // OpenCode does not have xhigh; max is closest
  max: 'max',
  minimal: 'minimal',
};

// runOpenCode — drop-in replacement for runCodex when backend is kimi or grok.
//
// args:
//   prompt    — string, user message + injected context
//   sessionId — string|null, opencode session id to resume; null = fresh
//   options   — {
//     model:        'openrouter/moonshotai/kimi-k2.6' or 'openrouter/x-ai/grok-4.3'
//     effort:       low|medium|high|xhigh|max
//     timeout:      seconds (wall-clock); bridge passes 7200
//     idleTimeout:  seconds (no-stdout); bridge passes 900 for kimi/grok
//     workspace:    cwd for the subprocess; defaults to process.cwd()
//     log:          function(msg) for log output; defaults to console.log
//     activeRefs:   { setSubprocess, setKillFn } — for /stop SIGTERM hook
//   }
function runOpenCode(prompt, sessionId, options = {}) {
  return new Promise((resolve, reject) => {
    const log = options.log || ((msg) => console.log(msg));
    const model = options.model;
    if (!model) return reject(new Error('runOpenCode: options.model is required'));

    const args = ['run'];
    args.push('--format', 'json');
    args.push('--model', model);

    if (options.effort) {
      const variant = OPENCODE_VARIANT[options.effort] || options.effort;
      args.push('--variant', variant);
    }

    if (sessionId) {
      args.push('--session', sessionId);
    }

    args.push(prompt);

    log(`Spawning: opencode run [${sessionId ? 'resume' : 'fresh'}] model=${model} variant=${OPENCODE_VARIANT[options.effort] || options.effort || 'default'} session=${sessionId || 'new'}`);

    // Env: pass OPENROUTER_API_KEY explicitly. OpenCode also reads its own
    // ~/.local/share/opencode/auth.json but env trumps that and lets us
    // drive credential source from the bridge.
    const cleanEnv = { ...process.env };
    if (!cleanEnv.OPENROUTER_API_KEY && options.openRouterKey) {
      cleanEnv.OPENROUTER_API_KEY = options.openRouterKey;
    }
    // Per-spawn config override (lets bridge route Grok to a trimmed MCP set
    // because xAI enforces a 200-tool cap that the full 25-MCP set blows past).
    const cfgPath = options.configPath || OPENCODE_CONFIG_PATH;
    if (fs.existsSync(cfgPath)) {
      cleanEnv.OPENCODE_CONFIG = cfgPath;
    }
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.MCP_CLAUDE;

    const proc = spawn(OPENCODE_BIN, args, {
      cwd: options.workspace || process.cwd(),
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own pgroup → tree-kill cascades to MCP children
    });

    const killTree = (signal) => {
      try { process.kill(-proc.pid, signal); }
      catch { try { proc.kill(signal); } catch { /* gone */ } }
    };

    if (options.activeRefs) {
      options.activeRefs.setSubprocess(proc);
      options.activeRefs.setKillFn(killTree);
    }

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let lastDataAt = Date.now();

    proc.stdout.on('data', (d) => { stdout += d.toString(); lastDataAt = Date.now(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); lastDataAt = Date.now(); });

    const timeoutMs = (options.timeout || 7200) * 1000;
    const idleMs = (options.idleTimeout || 900) * 1000;
    const timer = setTimeout(() => {
      log(`OpenCode subprocess wall-clock timeout after ${timeoutMs}ms, killing tree...`);
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 5000);
    }, timeoutMs);
    const idleTimer = setInterval(() => {
      const idleFor = Date.now() - lastDataAt;
      if (idleFor > idleMs) {
        log(`OpenCode subprocess idle ${Math.round(idleFor/1000)}s (no stdout/stderr; limit ${idleMs/1000}s), killing tree...`);
        clearInterval(idleTimer);
        killTree('SIGTERM');
        setTimeout(() => killTree('SIGKILL'), 5000);
      }
    }, 5000);

    proc.on('close', (code) => {
      if (options.activeRefs) {
        options.activeRefs.setSubprocess(null);
        options.activeRefs.setKillFn(null);
      }
      clearTimeout(timer);
      clearInterval(idleTimer);

      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(stderr.trim() || `opencode exited with code ${code}`));
      }

      // Parse JSONL — one event per line.
      // Schema (verified Whet 2026-05-06):
      //   step_start  → { sessionID, messageID, timestamp, part: { type: 'step-start' } }
      //   reasoning   → { sessionID, messageID, part: { type: 'reasoning', text, time, metadata } }
      //   text        → { sessionID, messageID, part: { type: 'text', text, time } }
      //   step_finish → { part: { type: 'step-finish', tokens, cost, reason } }
      let outSessionId = null;
      let textChunks = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      let reasoningTokens = 0;
      let totalCost = 0;
      let turns = 0;
      let errorMsg = null;

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed);
          if (ev.sessionID && !outSessionId) outSessionId = ev.sessionID;
          switch (ev.type) {
            case 'step_start':
              turns++;
              break;
            case 'tool_use':
              // OpenCode emits per-tool-call events with state.status='completed'
              // and full input/output. We don't surface these to Telegram (the bridge
              // shows only the final agent text) but log them for diagnostic.
              if (ev.part?.tool && ev.part?.state?.status === 'completed') {
                log(`opencode tool_use: ${ev.part.tool} (callID=${ev.part.callID || '?'})`);
              }
              break;
            case 'text':
              if (ev.part?.text) textChunks.push(ev.part.text);
              break;
            case 'step_finish': {
              const t = ev.part?.tokens || {};
              if (typeof t.input === 'number') inputTokens = t.input;
              if (typeof t.output === 'number' && t.output > 0) outputTokens = t.output;
              if (typeof t.reasoning === 'number') reasoningTokens = t.reasoning;
              if (t.cache && typeof t.cache.read === 'number') cachedInputTokens = t.cache.read;
              if (typeof ev.part?.cost === 'number') totalCost += ev.part.cost;
              // Only flag truly-bad finish reasons. 'stop' is normal end;
              // 'tool-calls' is a routine intermediate state when the model
              // pauses to call MCP tools (the next step continues normally).
              const reason = ev.part?.reason;
              if (reason && reason !== 'stop' && reason !== 'tool-calls') {
                errorMsg = `step-finish reason: ${reason}`;
              }
              break;
            }
            case 'error':
              // OpenCode error event shape: { type: 'error', error: { name, data: { message, statusCode, responseBody } } }
              // Also handle older shapes: { message }, { part: { text } }
              errorMsg = ev.error?.data?.message
                      || ev.error?.message
                      || ev.error?.name
                      || ev.message
                      || ev.part?.text
                      || JSON.stringify(ev).slice(0, 400);
              break;
          }
        } catch {
          // Not JSON, skip — opencode sometimes emits ANSI startup banner before JSON
        }
      }

      const finalText = textChunks.join('').trim();
      if (errorMsg && !finalText) {
        return reject(new Error(`OpenCode error: ${errorMsg.slice(0, 400)}`));
      }

      resolve({
        text: finalText,
        sessionId: outSessionId,
        cost: totalCost,
        turns: turns,
        duration: Date.now() - startTime,
        usage: { inputTokens, outputTokens, cachedInputTokens, reasoningTokens },
        isError: !!errorMsg,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      clearInterval(idleTimer);
      reject(new Error(`Failed to spawn opencode: ${err.message}`));
    });
  });
}

module.exports = { runOpenCode, OPENCODE_VARIANT };
