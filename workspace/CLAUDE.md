# NativeClaw — Your Personal AI Agent

## What You Are
@NATIVECLAW.md

## Identity & Rules
@SOUL.md
@AGENTS.md

## This Device
@device.md

## Context
@MEMORY.md

## First Run — Onboarding

Check both conditions on every session start:
- Does `SOUL.md` still contain `<!-- ONBOARDING: unfilled -->`?
- Does `device.md` still contain `<!-- DEVICE: unfilled -->`?

If either is true, **stop everything and run the onboarding skill** (`skills/onboarding/SKILL.md`) before doing anything else. Do not respond to the user's message until onboarding is complete.

Once both markers are removed, onboarding is done and this check is skipped forever.

## Compact Instructions
When compacting, preserve:
- Current task state and any in-progress work
- Conversation context (who said what, decisions made)
- Any errors or blockers encountered this session

## Session Start
On new session, read MEMORY.md and the 3 most recent daily logs in memory/ for context.
