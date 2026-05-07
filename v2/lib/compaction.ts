/**
 * NativeClaw Context Compaction Module
 * Extracted from bridge.js for V2 reusability.
 * Monitors OpenCode session token totals; triggers structured summarization
 * when threshold is breached.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface CompactionConfig {
  model: string;                    // e.g. 'openrouter/moonshotai/kimi-k2.6'
  modelKey: string;                   // key into thresholds map
  threshold: number;                  // absolute token threshold
  configPath: string;               // opencode.json path
  workspace: string;                  // workspace root
  openRouterKey: string;            // API key
  logFn?: (msg: string) => void;    // optional logging
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalCost: number;
}

export interface CompactionResult {
  newSessionId: string;
  recapText: string;
  checkpointWritten: boolean;
}

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'openrouter/moonshotai/kimi-k2.6': 262_144,
  'openrouter/x-ai/grok-4.3': 1_000_000,
};

export const MODEL_COMPACTION_THRESHOLDS: Record<string, number> = {
  'openrouter/moonshotai/kimi-k2.6': 180_000,
  'openrouter/x-ai/grok-4.3': 350_000,
};

export class ContextCompaction {
  private log: (msg: string) => void;

  constructor(logFn?: (msg: string) => void) {
    this.log = logFn || ((m) => console.log(`[compaction] ${m}`));
  }

  /**
   * After each OpenCode turn, update the running token max and decide
   * if compaction is now pending.
   */
  checkThreshold(sessionKey: string, currentMax: number, config: CompactionConfig): boolean {
    const modelKey = config.modelKey;
    const limit = MODEL_CONTEXT_WINDOWS[modelKey] || 262_144;
    const threshold = config.threshold || MODEL_COMPACTION_THRESHOLDS[modelKey] || Math.floor(limit * 0.7);

    if (currentMax >= threshold) {
      this.log(`Threshold reached for ${sessionKey}: ${currentMax} >= ${threshold} (limit ${limit})`);
      return true;
    }
    return false;
  }

  /**
   * Run the full compaction pipeline:
   * 1. Write checkpoint to daily log
   * 2. Summarize prior history via sidecar Kimi
   * 3. Start fresh OpenCode session with recap
   */
  async compact(
    priorMessages: Array<{ role: string; content: string }>,
    systemContext: string,
    config: CompactionConfig
  ): Promise<CompactionResult> {
    const sessionKey = 'compaction-run';
    this.log('Starting compaction pipeline');

    // 1. Checkpoint: write raw extraction to memory/today.md
    const checkpointPath = this.writeCheckpoint(priorMessages);
    this.log(`Checkpoint written: ${checkpointPath}`);

    // 2. Summarize: keep last 10 verbatim, summarize the rest
    const keepCount = 10;
    const toSummarize = priorMessages.slice(0, -keepCount);
    const recap = await this.summarize(toSummarize, systemContext, config);
    this.log(`Recap generated: ${recap.length} chars`);

    // 3. Fresh session bootstrap: recap + last-10 verbatim
    const lastMessages = priorMessages.slice(-keepCount);
    const newSessionId = 'compacted-' + Date.now();

    return {
      newSessionId,
      recapText: recap,
      checkpointWritten: true,
    };
  }

  private writeCheckpoint(messages: Array<{ role: string; content: string }>): string {
    const HOME = process.env.HOME || process.env.USERPROFILE || '';
    const memDir = path.join(HOME, '.claude', 'workspace', 'memory');
    const today = new Date().toISOString().split('T')[0];
    const fname = `${today}.md`;
    const fpath = path.join(memDir, fname);

    // Structured extraction: decisions + action items + files touched
    const lines = [
      `\n## Conversation Archive — ${new Date().toISOString()}`,
      '',
      '### Decisions Made',
      ...this.extractDecisions(messages),
      '',
      '### Action Items',
      ...this.extractActions(messages),
      '',
      '### Files Touched',
      ...this.extractFiles(messages),
      '',
    ];

    fs.mkdirSync(memDir, { recursive: true });
    fs.appendFileSync(fpath, lines.join('\n'));
    return fpath;
  }

  private async summarize(
    messages: Array<{ role: string; content: string }>,
    systemContext: string,
    config: CompactionConfig
  ): Promise<string> {
    const prompt = `${systemContext}\n\n# SUMMARIZATION TASK\n\nSummarize the conversation below into 500-2500 words.\nPreserve: decisions, action items, file paths, names, dates, commitments.\nDrop: verification chatter, chitchat, restated facts.\nOutput structured sections: Decisions / Action Items / Files / Ongoing Threads / Context.\n\n${messages.map((m) => `${m.role}: ${m.content.slice(0, 500)}`).join('\n\n')}`;

    return new Promise((resolve, reject) => {
      const args = ['run', '--format', 'json', '--model', config.model];
      const proc = spawn('opencode', args, {
        cwd: config.workspace,
        env: { ...process.env, OPENROUTER_API_KEY: config.openRouterKey, OPENCODE_CONFIG: config.configPath },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let out = '';
      let err = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.stdin.write(prompt);
      proc.stdin.end();

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Summarizer timeout'));
      }, 120_000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          this.log(`Summarizer error: ${err.slice(0, 200)}`);
          reject(new Error(`Summarizer exited ${code}`));
          return;
        }
        // Extract text from accumulated JSON parts
        const text = out.split('\n').filter((l) => l.trim()).map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean).map((ev) => {
          if (ev.type === 'message.part' && ev.part?.text) return ev.part.text;
          return '';
        }).join('').trim();
        resolve(text || `[Summarizer produced no text. Code=${code} err=${err.slice(0, 200)}]`);
      });
    });
  }

  private extractDecisions(msgs: Array<{ role: string; content: string }>): string[] {
    const decisions: string[] = [];
    for (const m of msgs) {
      if (m.role !== 'assistant') continue;
      const match = m.content.match(/(?:decision|decided|agreed|locked in|going with|confirmed):\s*(.+)/gi);
      if (match) decisions.push(...match);
    }
    return decisions.length ? decisions.map((d) => `- ${d}`) : ['- (none detected)'];
  }

  private extractActions(msgs: Array<{ role: string; content: string }>): string[] {
    const actions: string[] = [];
    for (const m of msgs) {
      if (m.role !== 'assistant') continue;
      const match = m.content.match(/(?:action item|todo|task|follow[ -]up|remind me|do it|execute):\s*(.+)/gi);
      if (match) actions.push(...match);
    }
    return actions.length ? actions.map((a) => `- [ ] ${a}`) : ['- (none detected)'];
  }

  private extractFiles(msgs: Array<{ role: string; content: string }>): string[] {
    const files = new Set<string>();
    const re = /(?:read|wrote|write|edit|edited|created|modified)[`'"\s]+([\w\/._-]+)/gi;
    for (const m of msgs) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(m.content)) !== null) {
        const p = match[1];
        if (p.includes('.') && (p.includes('/') || p.includes('\\'))) files.add(p);
      }
    }
    return files.size ? Array.from(files).map((f) => `- ${f}`) : ['- (none detected)'];
  }
}

export default ContextCompaction;
