# Self-Evaluation Framework

Weekly eval cron. Reads the past 7 days of daily logs and system state, scores each metric, sends a scorecard to Telegram, and saves to `memory/evals/`.

## Metrics

### 1. Checkpoint Frequency
- **Target:** 3+ checkpoints per active day (days where the user messaged)
- **How to measure:** Count `## ` headers in each daily log that contain "Checkpoint" or a time pattern (HH:MM)
- **Score:** PASS if all active days hit 3+, WARN if any day has 1-2, FAIL if any active day has 0

### 2. Feedback Logging Rate
- **Target:** 100% of corrections logged in the same session
- **How to measure:** Search daily logs for correction indicators. Cross-reference with entries added to `feedback/*.md` that week.
- **Score:** PASS if all corrections have matching feedback entries, FAIL if any are missing

### 3. Memory Updates
- **Target:** MEMORY.md updated within 24h of any significant status change
- **How to measure:** Search daily logs for status changes, check MEMORY.md mtime.
- **Score:** PASS if all changes reflected, FAIL if stale

### 4. Cron Job Success Rate
- **Target:** >90% success
- **How to measure:** Parse `~/.claude/logs/telegram-bridge.log` for "Cron ... completed" vs "Cron ... FAILED"
- **Score:** PASS if >90%, WARN if 80-90%, FAIL if <80%

### 5. Identity Compliance
- **Target:** 0 references to "Claude Code UI", "terminal", or generic assistant language
- **How to measure:** Grep bridge logs and daily logs for identity slips.
- **Score:** PASS if 0, FAIL if any found

## Scorecard Format

```
Weekly Eval — Week of [Date]

Checkpoints:    [PASS/WARN/FAIL] — [X] avg/day across [Y] active days
Feedback:       [PASS/WARN/FAIL] — [X] corrections found, [Y] logged
Memory:         [PASS/WARN/FAIL] — [details]
Cron Success:   [PASS/WARN/FAIL] — [X]% ([Y] completed, [Z] failed)
Identity:       [PASS/WARN/FAIL] — [X] slips found

Overall: [X]/5 PASS
```

## Storage
Save to `memory/evals/YYYY-MM-DD-eval.md`
