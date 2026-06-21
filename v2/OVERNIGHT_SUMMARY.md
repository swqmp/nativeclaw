# NativeClaw v2.0 - Build Summary

**Built:** May 7, 2026  
**Audited:** May 9, 2026  
**Status:** v2.0 shipped, then cleaned up after audit findings.

## What Actually Shipped

| Area | Status |
|---|---|
| Setup wizard | Browser flow + terminal TUI shipped |
| Settings UI | Localhost UI shipped, token generated per process |
| Cross-platform tooling | macOS/Linux/Windows scaffolding shipped |
| Backup/restore/doctor | CLI tools shipped |
| Voice | xAI Grok STT default, OpenAI/local fallbacks documented |
| Backends | Claude native, Codex native, OpenRouter profile lane through OpenCode |
| OpenRouter profiles | Built-in `kimi`, `minimax`, and `grok` profiles, plus custom model IDs |
| Compaction | Bridge-owned inline compaction; stale exported `lib/compaction.ts` removed |
| Subagents | Spec deferred to v2.1; module remains unwired |

## Corrected Audit Findings

- Old notes claimed Groq Whisper was the voice default. That was wrong. The shipped default is xAI Grok STT.
- Old notes claimed `lib/skills-extractor.ts` and `lib/voice-handler.ts` shipped. They were orphan modules and were deleted.
- Old notes claimed `lib/compaction.ts` was the v2 compaction implementation. It was stale and was deleted; the live bridge owns compaction.
- Old notes described Kimi/Grok as separate backend lanes. The cleaned architecture is a generic OpenRouter profile lane. Kimi, MiniMax, Grok, and future models are profiles.
- Old smoke-test claims were too broad. Current status must be verified with `npm run build`, `npm test`, and `npm run verify`.

## Current Verification Commands

```bash
cd projects/nativeclaw/v2
npm run build
npm test
npm run verify
```

Bridge syntax should also be checked before mirroring live:

```bash
node --check bridge/bridge.js
```

## Current User-Facing Commands

```text
/claude
/codex
/or list
/or profile <name>
/or set <name> <provider/model>
/or providers <name> --order A,B --fallbacks on|off
/kimi
/minimax
/grok
/stats
/compact
```

## Remaining v2.1 Work

- `/bg <prompt>` subagent delegation with async Telegram delivery.
- Optional background memory review.
- David UX test after graduation logistics clear.
- Windows live validation on the Corsair PC.
