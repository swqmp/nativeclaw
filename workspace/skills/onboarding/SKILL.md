# Onboarding Skill

Runs the first-time setup wizard for a fresh NativeClaw install.

## When To Run

Triggered automatically by CLAUDE.md when either:
- `SOUL.md` still contains `<!-- ONBOARDING: unfilled -->`
- `device.md` still contains `<!-- DEVICE: unfilled -->`

## Instructions

You are setting up a new NativeClaw instance. The user just installed you and hasn't configured anything yet. Walk through the steps below in order, one at a time. Ask each question, wait for the answer, then move on. Don't dump all questions at once.

---

### Step 0 — Introduction

Say:

> "Hey! I'm your new NativeClaw agent. Before I can be useful, I need to learn a few things about you and this device. This'll take about 5 minutes — let's go."

---

### Step 1 — Who You're Talking To (USER.md)

Ask these one at a time:

1. "What's your name?"
2. "What do you do? (job, school, side projects — whatever's relevant)"
3. "What's your typical daily schedule like? When do you wake up, when do you wind down?"
4. "What's your timezone?"
5. "Anything I should always know about you — preferences, things to never bring up, context that matters?"

Write answers to `USER.md`.

---

### Step 2 — Your Identity (SOUL.md)

Ask:

1. "What do you want to call me?" (agent name — can be anything)
2. "What's my role? Business assistant? Personal assistant? Coding partner? All of the above?"
3. "How should I communicate — casual and direct, or more professional and thorough?"
4. "Anything else about my personality you want to define?"

Write answers to `SOUL.md`. Remove the `<!-- ONBOARDING: unfilled -->` marker.

---

### Step 3 — Rules (AGENTS.md)

Ask:

1. "Should I ask before taking actions (commits, emails, deploys), or just do things and tell you after?"
2. "Any hard rules — things I should NEVER do without explicit permission?"
3. "How do you want me to handle errors — tell you immediately, or try to fix them first?"

Write answers to `AGENTS.md`.

---

### Step 4 — What You're Working On (MEMORY.md)

Ask:

1. "Any current projects, clients, or goals I should know about right now?"
2. "Anything on your plate that I should be tracking?"

Write answers to `MEMORY.md`.

---

### Step 5 — Tools & Services

Ask:

1. "What services do you use that you'd want me to connect to? (Gmail, Google Calendar, Notion, Linear, GitHub, etc.)"

For each service they mention, note it. Guide them to set up the relevant MCP server in `.mcp.json` if they want to do it now, or note it in MEMORY.md as a pending setup task.

---

### Step 6 — Device Setup (device.md)

Ask:

1. "What OS is this device running — macOS, Linux, or Windows?"
2. "What's this machine called or what should I call it?" (hostname or nickname)

Based on their answer, fill in `device.md` with the correct commands:

**macOS:**
```
Start:   launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist
Stop:    launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist
Restart: launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist && launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist
Logs:    tail -f ~/.claude/logs/telegram-bridge.log
```

**Linux:**
```
Start:   systemctl --user start nativeclaw
Stop:    systemctl --user stop nativeclaw
Restart: systemctl --user restart nativeclaw
Logs:    journalctl --user -u nativeclaw -f
```

**Windows:**
```
Start:   schtasks /run /tn "NativeClaw"
Stop:    schtasks /end /tn "NativeClaw"
Restart: schtasks /end /tn "NativeClaw" && schtasks /run /tn "NativeClaw"
Logs:    type %USERPROFILE%\.claude\logs\telegram-bridge.log
```

Remove the `<!-- DEVICE: unfilled -->` marker from `device.md`.

---

### Step 7 — Scheduled Tasks

Ask:

1. "Do you want a morning briefing? What time do you wake up?"
2. "End of day summary? What time do you wind down?"
3. "Any recurring tasks you want me to handle automatically?"

Note preferences and help them configure `cron-schedule.json` if they're ready, or save as pending setup.

---

### Step 8 — Wrap Up

Say:

> "You're all set. I'll remember everything from here on out. Just talk to me like normal — I'm here whenever you need me."

Write a summary of everything configured to `memory/YYYY-MM-DD.md` (today's date) with a `## Onboarding Complete` header.

---

## After Onboarding

Once both `<!-- ONBOARDING: unfilled -->` and `<!-- DEVICE: unfilled -->` markers are removed, this skill does not run again. The agent operates normally using the filled-in workspace files.
