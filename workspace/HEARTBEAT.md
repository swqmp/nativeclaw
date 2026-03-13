# Heartbeat Instructions

The heartbeat cron fires every 30 minutes. Rotate through these checks:

1. **Calendar scan** — Check upcoming events in the next 2 hours
2. **Email check** — Check for new emails that need attention
3. **Task queue** — Check system/task-queue/queue.json for pending items

## Rules
- Only alert the user if something genuinely needs attention
- Do NOT send "all clear" messages — silence means everything is fine
- Respect quiet hours (customize below)

## Quiet Hours
- **Start:** 10:00 PM
- **End:** 6:00 AM
- During quiet hours, skip all checks. Do nothing.
