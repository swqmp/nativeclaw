/**
 * NativeClaw Bridge-side Checkpoint Visibility
 * Alternative to the OpenCode plugin (which was pulled due to 60s startup overhead).
 * Inspects JSON streaming output from OpenCode and appends checkpoint notes directly.
 */

/**
 * Inspect OpenCode stderr JSON for tool events and build a human-readable
 * checkpoint line suitable for Telegram appending.
 */
export function inspectOpenCodeOutput(stderr: string, stdout: string): string[] {
  const notes: string[] = [];

  for (const line of stderr.split('\n').concat(stdout.split('\n'))) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'tool.execute') {
        const tool = ev.tool || ev.name || '';
        if (['Bash', 'Edit', 'Write', 'read', 'glob', 'grep'].includes(tool)) {
          notes.push(`⚡ ${tool}`);
        }
      }
      if (ev.type === 'file.write' || ev.type === 'file.edit') {
        const path = ev.path || ev.file || '';
        if (path.includes('.md') || path.includes('memory/')) {
          notes.push('📝 Checkpoint written');
        }
      }
    } catch {
      // Not JSON, skip
    }
  }

  return notes;
}

/**
 * Append a checkpoint summary line before the main response text.
 */
export function injectCheckpointNotes(responseText: string, notes: string[]): string {
  if (notes.length === 0) return responseText;
  const unique = [...new Set(notes)].slice(0, 5);
  const line = `[${unique.join(' · ')}]\n\n`;
  return line + responseText;
}

export default { inspectOpenCodeOutput, injectCheckpointNotes };
