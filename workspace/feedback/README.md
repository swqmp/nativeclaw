# feedback/

Durable correction log organized by task type. The agent reads the matching file **before** producing repeatable output (emails, reports, articles, code reviews), so it stops repeating mistakes across sessions.

## Rule (enforced by AGENTS.md)

Before producing output that has a template or repeatable shape, the agent **must** check the matching feedback file first.

## File convention

`feedback/<task-type>.md` — e.g. `feedback/emails.md`, `feedback/reports.md`, `feedback/general.md`.

Path format uses **slash**, not underscore. `feedback_general.md` at repo root is a silent bug — the agent will write to nowhere and your correction evaporates.

## Entry format

Each correction is a short bullet. Lead with the rule, then why. Example:

```markdown
## Writing style
- No em dashes in outbound messages — they read as AI-generated. Use commas or periods.
  - Why: flagged on 2026-03-14, two clients independently commented.

## Structure
- Lead with the ask, never with pleasantries. "Hey — quick ask: can you X?"
  - Why: conversion on cold outreach doubled after we swapped from paragraph leads.
```

## Starter templates

- `general.md` — catch-all for style, tone, defaults
- `emails.md` — email-specific
- `reports.md` — reports, summaries, status docs

Add more as needed: `cold-outreach.md`, `code-reviews.md`, `client-proposals.md`, etc. Match whatever output shapes you produce regularly.

## How the agent uses this

Before drafting an email: read `feedback/emails.md`. Before a report: read `feedback/reports.md`. If no matching file exists, check `general.md`. If the user corrects you during a task, write the correction to the matching file immediately — do not wait until the end of the session.
