/**
 * NativeClaw Bridge-side Checkpoint Visibility
 * Alternative to the OpenCode plugin (which was pulled due to 60s startup overhead).
 * Inspects JSON streaming output from OpenCode and appends checkpoint notes directly.
 */
/**
 * Inspect OpenCode stderr JSON for tool events and build a human-readable
 * checkpoint line suitable for Telegram appending.
 */
export declare function inspectOpenCodeOutput(stderr: string, stdout: string): string[];
/**
 * Append a checkpoint summary line before the main response text.
 */
export declare function injectCheckpointNotes(responseText: string, notes: string[]): string;
declare const _default: {
    inspectOpenCodeOutput: typeof inspectOpenCodeOutput;
    injectCheckpointNotes: typeof injectCheckpointNotes;
};
export default _default;
//# sourceMappingURL=bridge-checkpoint.d.ts.map