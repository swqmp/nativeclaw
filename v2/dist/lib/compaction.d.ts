/**
 * NativeClaw Context Compaction Module
 * Extracted from bridge.js for V2 reusability.
 * Monitors OpenCode session token totals; triggers structured summarization
 * when threshold is breached.
 */
export interface CompactionConfig {
    model: string;
    modelKey: string;
    threshold: number;
    configPath: string;
    workspace: string;
    openRouterKey: string;
    logFn?: (msg: string) => void;
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
export declare const MODEL_COMPACTION_THRESHOLDS: Record<string, number>;
export declare class ContextCompaction {
    private log;
    constructor(logFn?: (msg: string) => void);
    /**
     * After each OpenCode turn, update the running token max and decide
     * if compaction is now pending.
     */
    checkThreshold(sessionKey: string, currentMax: number, config: CompactionConfig): boolean;
    /**
     * Run the full compaction pipeline:
     * 1. Write checkpoint to daily log
     * 2. Summarize prior history via sidecar Kimi
     * 3. Start fresh OpenCode session with recap
     */
    compact(priorMessages: Array<{
        role: string;
        content: string;
    }>, systemContext: string, config: CompactionConfig): Promise<CompactionResult>;
    private writeCheckpoint;
    private summarize;
    private extractDecisions;
    private extractActions;
    private extractFiles;
}
export default ContextCompaction;
//# sourceMappingURL=compaction.d.ts.map