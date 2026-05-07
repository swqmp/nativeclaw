"use strict";
/**
 * NativeClaw Subagent Delegation Fix
 * Spawn background agents as child_process with own OpenCode session.
 * Parent returns immediately, polls for completion file on subsequent turns.
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
exports.SubagentDelegator = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const SUBAGENT_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', '.subagents');
class SubagentDelegator {
    log;
    constructor(logFn) {
        this.log = logFn || ((m) => console.log(`[subagent] ${m}`));
        fs.mkdirSync(SUBAGENT_DIR, { recursive: true });
    }
    /**
     * Spawn a background subagent and return immediately.
     * The subagent writes its result to a JSON file when done.
     */
    spawn(task) {
        const outputFile = path.join(SUBAGENT_DIR, `${task.id}.json`);
        if (fs.existsSync(outputFile))
            fs.unlinkSync(outputFile);
        const args = ['run', '--format', 'json', '--model', task.model, task.prompt];
        const proc = (0, child_process_1.spawn)('opencode', args, {
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
            const result = {
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
    poll(taskId) {
        const outputFile = path.join(SUBAGENT_DIR, `${taskId}.json`);
        if (!fs.existsSync(outputFile))
            return null;
        try {
            return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        }
        catch {
            return null;
        }
    }
    /**
     * List all completed subagent results.
     */
    listCompleted() {
        const files = fs.readdirSync(SUBAGENT_DIR).filter((f) => f.endsWith('.json'));
        return files.map((f) => {
            const p = path.join(SUBAGENT_DIR, f);
            try {
                return JSON.parse(fs.readFileSync(p, 'utf8'));
            }
            catch {
                return null;
            }
        }).filter(Boolean);
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
exports.SubagentDelegator = SubagentDelegator;
exports.default = SubagentDelegator;
//# sourceMappingURL=subagent-delegation.js.map