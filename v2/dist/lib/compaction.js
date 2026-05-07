"use strict";
/**
 * NativeClaw Context Compaction Module
 * Extracted from bridge.js for V2 reusability.
 * Monitors OpenCode session token totals; triggers structured summarization
 * when threshold is breached.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextCompaction = exports.MODEL_COMPACTION_THRESHOLDS = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MODEL_CONTEXT_WINDOWS = {
    'openrouter/moonshotai/kimi-k2.6': 262_144,
    'openrouter/x-ai/grok-4.3': 1_000_000,
};
exports.MODEL_COMPACTION_THRESHOLDS = {
    'openrouter/moonshotai/kimi-k2.6': 180_000,
    'openrouter/x-ai/grok-4.3': 350_000,
};
class ContextCompaction {
    log;
    constructor(logFn) {
        this.log = logFn || ((m) => console.log(`[compaction] ${m}`));
    }
    /**
     * After each OpenCode turn, update the running token max and decide
     * if compaction is now pending.
     */
    checkThreshold(sessionKey, currentMax, config) {
        const modelKey = config.modelKey;
        const limit = MODEL_CONTEXT_WINDOWS[modelKey] || 262_144;
        const threshold = config.threshold || exports.MODEL_COMPACTION_THRESHOLDS[modelKey] || Math.floor(limit * 0.7);
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
    async compact(priorMessages, systemContext, config) {
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
    writeCheckpoint(messages) {
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
    async summarize(messages, systemContext, config) {
        const prompt = `${systemContext}\n\n# SUMMARIZATION TASK\n\nSummarize the conversation below into 500-2500 words.\nPreserve: decisions, action items, file paths, names, dates, commitments.\nDrop: verification chatter, chitchat, restated facts.\nOutput structured sections: Decisions / Action Items / Files / Ongoing Threads / Context.\n\n${messages.map((m) => `${m.role}: ${m.content.slice(0, 500)}`).join('\n\n')}`;
        return new Promise((resolve, reject) => {
            const args = ['run', '--format', 'json', '--model', config.model];
            const proc = (0, child_process_1.spawn)('opencode', args, {
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
                    try {
                        return JSON.parse(l);
                    }
                    catch {
                        return null;
                    }
                }).filter(Boolean).map((ev) => {
                    if (ev.type === 'message.part' && ev.part?.text)
                        return ev.part.text;
                    return '';
                }).join('').trim();
                resolve(text || `[Summarizer produced no text. Code=${code} err=${err.slice(0, 200)}]`);
            });
        });
    }
    extractDecisions(msgs) {
        const decisions = [];
        for (const m of msgs) {
            if (m.role !== 'assistant')
                continue;
            const match = m.content.match(/(?:decision|decided|agreed|locked in|going with|confirmed):\s*(.+)/gi);
            if (match)
                decisions.push(...match);
        }
        return decisions.length ? decisions.map((d) => `- ${d}`) : ['- (none detected)'];
    }
    extractActions(msgs) {
        const actions = [];
        for (const m of msgs) {
            if (m.role !== 'assistant')
                continue;
            const match = m.content.match(/(?:action item|todo|task|follow[ -]up|remind me|do it|execute):\s*(.+)/gi);
            if (match)
                actions.push(...match);
        }
        return actions.length ? actions.map((a) => `- [ ] ${a}`) : ['- (none detected)'];
    }
    extractFiles(msgs) {
        const files = new Set();
        const re = /(?:read|wrote|write|edit|edited|created|modified)[`'"\s]+([\w\/._-]+)/gi;
        for (const m of msgs) {
            let match;
            while ((match = re.exec(m.content)) !== null) {
                const p = match[1];
                if (p.includes('.') && (p.includes('/') || p.includes('\\')))
                    files.add(p);
            }
        }
        return files.size ? Array.from(files).map((f) => `- ${f}`) : ['- (none detected)'];
    }
}
exports.ContextCompaction = ContextCompaction;
exports.default = ContextCompaction;
//# sourceMappingURL=compaction.js.map