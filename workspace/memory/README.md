# memory/

Daily logs live here. One file per day: `YYYY-MM-DD.md`.

## Format

Append checkpoints throughout the day. The agent uses this exact structure so QMD can parse and search them:

```markdown
## Checkpoint HH:MM — short topic summary

### What we did
- Specific actions (files, tools, outcomes)

### Decisions made
- What was decided AND why

### Open questions
- Unresolved items

### Next actions
- Queued work

### Feedback logged
- File path (e.g. `feedback/emails.md`) or "nothing new"

### MEMORY.md delta
- What got promoted this session, or "nothing durable"
```

## Trigger events

Agent writes a checkpoint when:
- A major topic ends
- A decision is made
- A task completes
- Every ~10 exchanges
- Before any risky operation (commits, sends, deploys)

## Why it matters

Context compaction nukes in-memory state around 100k tokens. If it isn't in a file, it's gone. Daily logs are the agent's only continuity across compactions, crashes, and backend switches.

Snapshots of MEMORY.md (via `system/scripts/snapshot-memory.sh`) go to `memory/snapshots/`. Last 30 are kept.
