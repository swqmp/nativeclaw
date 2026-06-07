function formatTokenAmount(tokens) {
  const n = Number(tokens || 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) {
    const value = n / 1_000_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const value = n / 1_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}k`;
  }
  return String(Math.round(n));
}

function normalizeCodexTokenInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const last = info.last_token_usage || {};
  const total = info.total_token_usage || {};
  const inputTokens = Number(last.input_tokens || 0);
  const outputTokens = Number(last.output_tokens || 0);
  const cachedInputTokens = Number(last.cached_input_tokens || 0);
  const reasoningTokens = Number(last.reasoning_output_tokens || 0);
  const contextTokens = Number(last.total_tokens || (inputTokens + outputTokens));
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    contextTokens,
    totalInputTokens: Number(total.input_tokens || 0),
    totalOutputTokens: Number(total.output_tokens || 0),
    totalCachedInputTokens: Number(total.cached_input_tokens || 0),
    totalReasoningTokens: Number(total.reasoning_output_tokens || 0),
    totalTokens: Number(total.total_tokens || ((total.input_tokens || 0) + (total.output_tokens || 0))),
    commandInputTokens: Number(total.input_tokens || 0),
    commandOutputTokens: Number(total.output_tokens || 0),
    commandCachedInputTokens: Number(total.cached_input_tokens || 0),
    commandReasoningTokens: Number(total.reasoning_output_tokens || 0),
    commandTotalTokens: Number(total.total_tokens || ((total.input_tokens || 0) + (total.output_tokens || 0))),
  };
}

function contextTokensFromUsage(usage, backend) {
  if (!usage) return 0;
  if (Number.isFinite(Number(usage.contextTokens)) && Number(usage.contextTokens) > 0) {
    return Number(usage.contextTokens);
  }
  if (backend === 'codex') {
    return (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
  }
  return (Number(usage.inputTokens) || 0)
       + (Number(usage.outputTokens) || 0)
       + (Number(usage.cachedInputTokens) || 0)
       + (Number(usage.reasoningTokens) || 0);
}

function getContextWindowTokens(model, backend, reportedWindow, profile) {
  if (Number.isFinite(Number(reportedWindow)) && Number(reportedWindow) > 0) return Number(reportedWindow);
  if (profile && Number.isFinite(Number(profile.contextWindow))) return Number(profile.contextWindow);
  if (backend === 'claude') {
    if (model && (model.includes('opus-4-7') || model.includes('opus-4.7'))) return 1_000_000;
    return 200_000;
  }
  if (backend === 'minimax' || (model && model.includes('minimax'))) return 197_000;
  if (backend === 'kimi' || (model && model.includes('kimi'))) return 262_144;
  if (backend === 'openrouter') return 262_144;
  if (backend === 'codex') return 258_400;
  return 0;
}

function formatStatsContextLines(last, profile) {
  const windowTokens = getContextWindowTokens(last.model, last.backend, last.contextWindow, profile);
  const filled = contextTokensFromUsage(last.usage, last.backend);
  const windowLabel = windowTokens > 0 ? formatTokenAmount(windowTokens) : 'unknown';
  const lines = [`  Context window: ${windowLabel}`];
  if (filled > 0 && windowTokens > 0) {
    const pct = ((filled / windowTokens) * 100).toFixed(1);
    lines.push(`  Current context: ${formatTokenAmount(filled)} / ${windowLabel} (${pct}%)`);
  } else if (filled > 0) {
    lines.push(`  Current context: ${formatTokenAmount(filled)}`);
  } else {
    lines.push('  Current context: unknown');
  }
  return lines;
}

module.exports = {
  formatTokenAmount,
  normalizeCodexTokenInfo,
  contextTokensFromUsage,
  getContextWindowTokens,
  formatStatsContextLines,
};
