/**
 * NativeClaw Subagent Delegation Fix
 * Spawn background agents as child_process with own OpenCode session.
 * Parent returns immediately, polls for completion file on subsequent turns.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface SubagentTask {
  id: string;
  prompt: string;
  model: string;
  configPath: string;
  workspace: string;
  openRouterKey: string;
  timeout: number;
  idleTimeout: number;
}

export interface SubagentResult {
  id: string;
  status: 'running' | 'completed' | 'failed';
  text?: string;
  error?: string;
  outputFile: string;
}

const SUBAGENT_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude',
  '.subagents'
);

export class SubagentDelegator {
  private log: (msg: string) => void;

  constructor(logFn?: (msg: string) => void) {
    this.log = logFn || ((m) => console.log(`[subagent] ${m}`));
    fs.mkdirSync(SUBAGENT_DIR, { recursive: true });
  }

  /**
   * Spawn a background subagent and return immediately.
   * The subagent writes its result to a JSON file when done.
   */
  spawn(task: SubagentTask): SubagentResult {
    const outputFile = path.join(SUBAGENT_DIR, `${task.id}.json`);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

    const args = ['run', '--format', 'json', '--model', task.model, task.prompt];
    const proc = spawn('opencode', args, {
      cwd: task.workspace,
      env: {
        ...process.env,
        OPENROUTER_API_KEY: task.openRouterKey,
        OPENCODE_CONFIG: task.configPath,
        NATIVECLAW_SUBAGENT_MODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    const timer = setTimeout(() => {
      this.log(`Subagent ${task.id} wall-clock timeout (${task.timeout}s), killing...`);
      if (proc.pid) {
        process.kill(-proc.pid, 'SIGTERM');
      }
    }, task.timeout * 1000);

    const idleTimer = setInterval(() => {
      // Simplified: no idle tracking in subagent mode; rely on timeout
      void 0;
    }, 5000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(idleTimer);
      const result: SubagentResult = {
        id: task.id,
        status: code === 0 ? 'completed' : 'failed',
        text: out.trim(),
        error: err.trim() || undefined,
        outputFile,
      };
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
      this.log(`Subagent ${task.id} finished: ${result.status}`);
    });

    proc.unref(); // let parent exit without waiting

    return {
      id: task.id,
      status: 'running',
      outputFile,
    };
  }

  /**
   * Poll for a subagent's completion. Returns null if still running.
   */
  poll(taskId: string): SubagentResult | null {
    const outputFile = path.join(SUBAGENT_DIR, `${taskId}.json`);
    if (!fs.existsSync(outputFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * List all completed subagent results.
   */
  listCompleted(): SubagentResult[] {
    const files = fs.readdirSync(SUBAGENT_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      const p = path.join(SUBAGENT_DIR, f);
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
    }).filter(Boolean) as SubagentResult[];
  }

  /**
   * Clean up subagent files older than N days.
   */
  cleanup(maxAgeDays = 7) {
    const now = Date.now();
    const files = fs.readdirSync(SUBAGENT_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const p = path.join(SUBAGENT_DIR, f);
      const stat = fs.statSync(p);
      const ageMs = now - stat.mtimeMs;
      if (ageMs > maxAgeDays * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(p);
        this.log(`Cleaned up old subagent result: ${f}`);
      }
    }
  }
}

export default SubagentDelegator;
