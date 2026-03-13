#!/bin/bash
# Send a message directly to Telegram (used by crons to notify the user)
# Usage: bash telegram_direct.sh "Your message here"

CONFIG="$HOME/.claude/telegram-bridge/config.json"

if [ ! -f "$CONFIG" ]; then
    echo "ERROR: No config at $CONFIG"
    exit 1
fi

BOT_TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG'))['botToken'])")
CHAT_ID=$(python3 -c "import json; print(json.load(open('$CONFIG'))['allowedChatIds'][0])")

MSG="$1"
if [ -z "$MSG" ]; then
    echo "Usage: telegram_direct.sh \"message\""
    exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": $(echo "$MSG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" \
    > /dev/null

echo "Sent."
