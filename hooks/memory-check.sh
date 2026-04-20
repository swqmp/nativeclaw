#!/usr/bin/env bash
# memory-check.sh — UserPromptSubmit hook.
# If the user's message mentions a person/company by name OR uses history phrasing,
# inject a hard-rule reminder to call `search_memory` before answering historically.
#
# Wire this into ~/.claude/settings.json as a UserPromptSubmit hook:
#   {
#     "hooks": {
#       "UserPromptSubmit": [
#         {
#           "hooks": [
#             { "type": "command", "command": "bash PATH_TO_NATIVECLAW/hooks/memory-check.sh" }
#           ]
#         }
#       ]
#     }
#   }
#
# The clients file lives at $NATIVECLAW_WORKSPACE/system/memory-hook-clients.txt
# (one name per line). If absent, only the generic history keywords trigger.

set -u

WORKSPACE="${NATIVECLAW_WORKSPACE:-$HOME/.claude/workspace}"
CLIENTS_FILE="$WORKSPACE/system/memory-hook-clients.txt"

msg=$(jq -r '.tool_input.prompt // .tool_input.message // ""' 2>/dev/null | tr '[:upper:]' '[:lower:]')

# People/company names you want the agent to always search memory for.
# User maintains this list; one name per line.
if [[ -r "$CLIENTS_FILE" ]]; then
  clients=$(paste -sd'|' "$CLIENTS_FILE")
else
  clients=""
fi

# Generic history phrasing that should trigger a memory search.
keywords='when did|what happened|do you remember|did we|last time|last week|last month|previously|before|called|meeting|agreed|price|retainer|paid|follow up|how much|who is|who was|have we|were we|was there'

pattern="$keywords"
if [[ -n "$clients" ]]; then
  pattern="$clients|$keywords"
fi

if echo "$msg" | grep -qiE "$pattern"; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "UserPromptSubmit",
      "additionalContext": "⚡ MEMORY CHECK: DO NOT respond with any historical claims until you have called search_memory. This is a hard rule. Search first, then answer. If search returns nothing, say so — do not fill gaps with assumptions."
    }
  }'
fi
