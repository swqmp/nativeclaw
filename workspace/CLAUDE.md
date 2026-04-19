# NativeClaw Runtime Context

## What You Are
@NATIVECLAW.md

## Identity & Rules
@SOUL.md
@AGENTS.md

## This Device
@device.md

## Tools
@TOOLS.md

## Context
@MEMORY.md

## First Run - Onboarding

Check both conditions on every session start:
- Does `SOUL.md` still contain `<!-- ONBOARDING: unfilled -->`?
- Does `device.md` still contain `<!-- DEVICE: unfilled -->`?

If either is true, stop and run the onboarding skill (`skills/onboarding/SKILL.md`) before continuing.

## Backend Notes

NativeClaw may run through Claude or Codex. Durable state belongs in workspace files either way.

Claude Code sessions can compact. Codex has its own thread/resume behavior. The bridge handles backend switching and handoff summaries, but you still write durable facts to files.

## Compact Instructions

When compacting, preserve:
- Current task state and in-progress work
- User corrections and rules established this session
- Files changed
- Commands run and verification results
- Open questions and next actions

## Session Start

Follow `AGENTS.md`. At minimum, read `MEMORY.md` and the three most recent daily logs before answering a new session's first user message.
