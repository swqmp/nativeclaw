/**
 * NativeClaw Subagent Delegation Fix
 * Spawn background agents as child_process with own OpenCode session.
 * Parent returns immediately, polls for completion file on subsequent turns.
 */
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
export declare class SubagentDelegator {
    private log;
    constructor(logFn?: (msg: string) => void);
    /**
     * Spawn a background subagent and return immediately.
     * The subagent writes its result to a JSON file when done.
     */
    spawn(task: SubagentTask): SubagentResult;
    /**
     * Poll for a subagent's completion. Returns null if still running.
     */
    poll(taskId: string): SubagentResult | null;
    /**
     * List all completed subagent results.
     */
    listCompleted(): SubagentResult[];
    /**
     * Clean up subagent files older than N days.
     */
    cleanup(maxAgeDays?: number): void;
}
export default SubagentDelegator;
//# sourceMappingURL=subagent-delegation.d.ts.map