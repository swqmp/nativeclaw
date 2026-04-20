# Task Queue

Persistent task queue that survives rate limits, cooldowns, and session resets. The bridge `task-queue-recovery` cron picks up pending/rate-limited tasks and retries them every hour.

## File: `queue.json`

```json
{
  "tasks": [
    {
      "id": "unique-id",
      "description": "one-sentence summary",
      "prompt": "full instructions for the agent to execute",
      "status": "pending|in-progress|completed|failed|rate-limited",
      "priority": "high|medium|low",
      "created": "2026-04-19T20:00:00-05:00",
      "updated": "2026-04-19T20:00:00-05:00",
      "retryCount": 0,
      "maxRetries": 5,
      "lastError": null,
      "result": null,
      "reportedToUser": false
    }
  ]
}
```

## Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Waiting to be picked up |
| `in-progress` | Currently executing |
| `completed` | Done, waiting to be reported back to the user |
| `failed` | Exceeded `maxRetries` |
| `rate-limited` | Cooldown — will auto-retry next cron cycle |

## When to queue

- User gave a task and you hit a rate limit partway through → mark remainder rate-limited.
- User asked for something scheduled ("do X at 3pm", "finish this overnight") → queue with `dueBy` field.
- Task is long-running and you want it survivable across session compaction.

## Not for

- Conversational turns (those live in the Telegram backlog).
- Tasks that must complete in the current turn (rate-limit recovery is async).
