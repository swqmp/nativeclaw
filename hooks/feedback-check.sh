#!/usr/bin/env bash
# feedback-check.sh — UserPromptSubmit hook.
# If the user seems to be correcting the agent, inject a reminder to
# write the correction to feedback/<task-type>.md BEFORE continuing.
set -u

msg=$(jq -r '.tool_input.prompt // .tool_input.message // ""' 2>/dev/null | tr '[:upper:]' '[:lower:]')

corrections='no,? not that|don.t do that|stop doing|that.s wrong|fix that|that.s not right|you forgot|you missed|you didn.t|go back|redo that|try again|i told you|i said|not what i|that.s incorrect|wrong'

if echo "$msg" | grep -qiE "$corrections"; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "UserPromptSubmit",
      "additionalContext": "⚠️ FEEDBACK DETECTED: the user may have just corrected you. Before continuing: (1) write the correction to the matching feedback/*.md file NOW, (2) if it is a new hard rule, add to AGENTS.md, (3) confirm with the file path. Do NOT acknowledge without writing."
    }
  }'
fi
