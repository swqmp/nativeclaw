# QMD — Quick Memory Database

Semantic search over your agent's memory. Embeds daily logs, MEMORY.md, AGENTS.md, SOUL.md, USER.md, TOOLS.md, REFERENCE.md, feedback files, and shared-memory cross-agent logs using Google's Gemini Embedding 2 model (1536 dimensions).

## Why this matters

Without QMD your agent has amnesia. Every time you reference a client, a past decision, a price, a conversation from last week — the agent either makes it up, or rehashes the whole MEMORY.md file hoping the right sentence is there. QMD gives you a `search_memory` tool that returns the 3-10 most relevant memory chunks for any query, with recency-weighted scoring and deduplication.

## Requirements

- **Gemini API key** — free tier works for personal use. Get one at https://aistudio.google.com/apikey.
- **Node.js 18+** — the server is stdio JSON-RPC.

## Setup

1. Store your key in the system keychain (not inline in `.mcp.json`):
   ```bash
   bash workspace/system/scripts/keychain-add.sh GEMINI_API_KEY
   ```
2. Enable the qmd entry in `workspace/.mcp.json` (it ships commented out by default).
3. Restart the agent. First boot takes ~30s to build the index.

## Tools exposed

- `search_memory(query, limit=10)` — semantic search over indexed memory
- `reindex_memory()` — re-embed changed files (idempotent, cheap if nothing changed)
- `memory_stats()` — index size, chunk count, model, dims

## Index location

`workspace/system/mcp/qmd/index.json` — regenerated via `reindex_memory`. Grows with your daily logs; safe to delete, will rebuild on next search.

## Hard rule (AGENTS.md enforces this)

When the user mentions a person/company by name, or uses history phrasing ("when did", "last week", "did we", "agreed", "paid"), **call `search_memory` before answering**. Do not fabricate history from training data.
