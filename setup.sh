#!/bin/bash
# NativeClaw Setup Wizard
# Run this after cloning the repo to set up your personal AI agent.

set -e

CLAUDE_DIR="$HOME/.claude"
BRIDGE_DIR="$CLAUDE_DIR/telegram-bridge"
SCRIPTS_DIR="$CLAUDE_DIR/scripts"
WORKSPACE_DIR="$CLAUDE_DIR/workspace"
LOG_DIR="$CLAUDE_DIR/logs"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "============================================"
echo "  NativeClaw Setup"
echo "  Your personal AI agent via Telegram"
echo "============================================"
echo ""

# -------------------------------------------------------
# Check prerequisites
# -------------------------------------------------------
echo "[1/8] Checking prerequisites..."

OS="$(uname -s)"

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    if [[ "$OS" == MINGW* || "$OS" == MSYS* || "$OS" == CYGWIN* ]]; then
        echo "Install it: https://nodejs.org"
    else
        echo "Install it: brew install node (macOS) or https://nodejs.org"
    fi
    exit 1
fi

if ! command -v claude &> /dev/null; then
    echo "ERROR: Claude Code CLI is not installed."
    echo "Install it: npm install -g @anthropic-ai/claude-code"
    echo "Then run: claude auth login"
    exit 1
fi

echo "  Node.js: $(node --version)"
echo "  Claude CLI: found"
echo ""

# -------------------------------------------------------
# Telegram bot setup
# -------------------------------------------------------
echo "[2/8] Telegram Bot Setup"
echo ""
echo "  You need a Telegram bot. If you don't have one:"
echo "  1. Open Telegram and message @BotFather"
echo "  2. Send /newbot and follow the prompts"
echo "  3. Copy the bot token it gives you"
echo ""
read -p "  Enter your Telegram bot token: " BOT_TOKEN

if [ -z "$BOT_TOKEN" ]; then
    echo "ERROR: Bot token is required."
    exit 1
fi

echo ""
echo "  Now I need your Telegram chat ID."
echo "  1. Message your new bot anything (just say 'hi')"
echo "  2. Then press Enter here and I'll detect it automatically"
echo ""
read -p "  Press Enter after messaging your bot..."

CHAT_ID=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data.get('result'):
    print(data['result'][-1]['message']['chat']['id'])
else:
    print('')
" 2>/dev/null)

if [ -z "$CHAT_ID" ]; then
    echo "  Couldn't detect chat ID automatically."
    read -p "  Enter your Telegram chat ID manually: " CHAT_ID
fi

echo "  Chat ID: $CHAT_ID"
echo ""

# -------------------------------------------------------
# Choose default model
# -------------------------------------------------------
echo "[3/8] Default Model"
echo ""
echo "  1) Sonnet 4.6 (recommended — fast, capable)"
echo "  2) Opus 4.6 (most capable, slower)"
echo "  3) Haiku 4.5 (fastest, less capable)"
echo ""
read -p "  Choose [1/2/3]: " MODEL_CHOICE

case $MODEL_CHOICE in
    2) MODEL="opus" ;;
    3) MODEL="haiku" ;;
    *) MODEL="sonnet" ;;
esac

echo "  Selected: $MODEL"
echo ""

# -------------------------------------------------------
# Create directory structure
# -------------------------------------------------------
echo "[4/8] Creating directories..."

mkdir -p "$BRIDGE_DIR"
mkdir -p "$SCRIPTS_DIR"
mkdir -p "$WORKSPACE_DIR/memory"
mkdir -p "$WORKSPACE_DIR/feedback"
mkdir -p "$WORKSPACE_DIR/system/task-queue"
mkdir -p "$LOG_DIR"
mkdir -p "$CLAUDE_DIR/telegram-images"

echo "  Done."
echo ""

# -------------------------------------------------------
# Copy files
# -------------------------------------------------------
echo "[5/8] Installing files..."

# Bridge
cp "$REPO_DIR/bridge/bridge.js" "$BRIDGE_DIR/bridge.js"

# Scripts — platform-specific
if [[ "$OS" == MINGW* || "$OS" == MSYS* || "$OS" == CYGWIN* ]]; then
    cp "$REPO_DIR/windows/claude-restart.ps1" "$SCRIPTS_DIR/claude-restart.ps1"
    cp "$REPO_DIR/windows/telegram_direct.ps1" "$SCRIPTS_DIR/telegram_direct.ps1"
else
    cp "$REPO_DIR/scripts/claude-restart.sh" "$SCRIPTS_DIR/claude-restart.sh"
    cp "$REPO_DIR/scripts/telegram_direct.sh" "$SCRIPTS_DIR/telegram_direct.sh"
    chmod +x "$SCRIPTS_DIR/claude-restart.sh"
    chmod +x "$SCRIPTS_DIR/telegram_direct.sh"
fi

# Workspace templates (only if they don't already exist — don't overwrite)
for file in CLAUDE.md SOUL.md AGENTS.md MEMORY.md USER.md HEARTBEAT.md IDENTITY.md TOOLS.md NATIVECLAW.md; do
    if [ ! -f "$WORKSPACE_DIR/$file" ]; then
        cp "$REPO_DIR/workspace/$file" "$WORKSPACE_DIR/$file"
        echo "  Created $file"
    else
        echo "  Skipped $file (already exists)"
    fi
done

# MCP config template
if [ ! -f "$WORKSPACE_DIR/.mcp.json" ]; then
    cp "$REPO_DIR/workspace/.mcp.json.example" "$WORKSPACE_DIR/.mcp.json"
    echo "  Created .mcp.json from template"
else
    echo "  Skipped .mcp.json (already exists)"
fi

# Skills
mkdir -p "$WORKSPACE_DIR/skills"
if [ -d "$REPO_DIR/workspace/skills/skill-creator" ]; then
    cp -R "$REPO_DIR/workspace/skills/skill-creator" "$WORKSPACE_DIR/skills/" 2>/dev/null
    echo "  Installed skill: skill-creator"
fi
if [ -d "$REPO_DIR/workspace/skills/mcp-builder" ]; then
    cp -R "$REPO_DIR/workspace/skills/mcp-builder" "$WORKSPACE_DIR/skills/" 2>/dev/null
    echo "  Installed skill: mcp-builder"
fi
if [ -d "$REPO_DIR/workspace/skills/onboarding" ]; then
    cp -R "$REPO_DIR/workspace/skills/onboarding" "$WORKSPACE_DIR/skills/" 2>/dev/null
    echo "  Installed skill: onboarding"
fi

# Write device.md with correct OS-specific commands
if [ ! -f "$WORKSPACE_DIR/device.md" ]; then
    if [ "$OS" = "Darwin" ]; then
        PLIST="$HOME/Library/LaunchAgents/com.nativeclaw.session.plist"
        cat > "$WORKSPACE_DIR/device.md" << DEVICEEOF
# Device Configuration

**OS:** macOS
**Platform:** macOS (launchd)
**Hostname:** $(hostname)

## Service Commands

**Start:**
\`\`\`
launchctl load $PLIST
\`\`\`

**Stop:**
\`\`\`
launchctl unload $PLIST
\`\`\`

**Restart:**
\`\`\`
launchctl unload $PLIST && launchctl load $PLIST
\`\`\`

**View logs:**
\`\`\`
tail -f ~/.claude/logs/telegram-bridge.log
\`\`\`
DEVICEEOF
    elif [ "$OS" = "Linux" ]; then
        cat > "$WORKSPACE_DIR/device.md" << DEVICEEOF
# Device Configuration

**OS:** Linux
**Platform:** Linux (systemd)
**Hostname:** $(hostname)

## Service Commands

**Start:**
\`\`\`
systemctl --user start nativeclaw
\`\`\`

**Stop:**
\`\`\`
systemctl --user stop nativeclaw
\`\`\`

**Restart:**
\`\`\`
systemctl --user restart nativeclaw
\`\`\`

**View logs:**
\`\`\`
journalctl --user -u nativeclaw -f
\`\`\`
DEVICEEOF
    else
        cat > "$WORKSPACE_DIR/device.md" << DEVICEEOF
# Device Configuration

**OS:** Windows
**Platform:** Windows (Task Scheduler)
**Hostname:** $(hostname)

## Service Commands

**Start:**
\`\`\`
schtasks /run /tn "NativeClaw"
\`\`\`

**Stop:**
\`\`\`
schtasks /end /tn "NativeClaw"
\`\`\`

**Restart:**
\`\`\`
schtasks /end /tn "NativeClaw" && schtasks /run /tn "NativeClaw"
\`\`\`

**View logs:**
\`\`\`
type %USERPROFILE%\.claude\logs\telegram-bridge.log
\`\`\`
DEVICEEOF
    fi
    echo "  Created device.md ($(uname -s))"
else
    echo "  Skipped device.md (already exists)"
fi

# Cron schedule
if [ ! -f "$CLAUDE_DIR/cron-schedule.json" ]; then
    cp "$REPO_DIR/cron-schedule.example.json" "$CLAUDE_DIR/cron-schedule.json"
    echo "  Created cron-schedule.json from template"
else
    echo "  Skipped cron-schedule.json (already exists)"
fi

# Task queue init
if [ ! -f "$WORKSPACE_DIR/system/task-queue/queue.json" ]; then
    echo '{"tasks":[]}' > "$WORKSPACE_DIR/system/task-queue/queue.json"
fi

echo "  Done."
echo ""

# -------------------------------------------------------
# Generate config
# -------------------------------------------------------
echo "[6/8] Generating config..."

if [ "$OS" = "Darwin" ]; then
    RESTART_CMD="nohup bash -c 'sleep 2 && launchctl unload ~/Library/LaunchAgents/com.nativeclaw.session.plist && launchctl load ~/Library/LaunchAgents/com.nativeclaw.session.plist' >/dev/null 2>&1 &"
elif [ "$OS" = "Linux" ]; then
    RESTART_CMD="nohup bash -c 'sleep 2 && systemctl --user restart nativeclaw' >/dev/null 2>&1 &"
else
    RESTART_CMD="nohup bash -c 'sleep 2 && schtasks /end /tn NativeClaw && schtasks /run /tn NativeClaw' >/dev/null 2>&1 &"
fi

cat > "$BRIDGE_DIR/config.json" << EOF
{
  "botToken": "$BOT_TOKEN",
  "allowedChatIds": ["$CHAT_ID"],
  "workspace": "$WORKSPACE_DIR",
  "mcpConfig": "$WORKSPACE_DIR/.mcp.json",
  "cronSchedule": "$CLAUDE_DIR/cron-schedule.json",
  "model": "$MODEL",
  "restartCommand": "$RESTART_CMD"
}
EOF

if [[ "$OS" == MINGW* || "$OS" == MSYS* || "$OS" == CYGWIN* ]]; then
    WIN_CONFIG=$(cygpath -w "$BRIDGE_DIR/config.json")
    icacls "$WIN_CONFIG" /inheritance:r /grant:r "$USERNAME:(R,W)" > /dev/null 2>&1
else
    chmod 600 "$BRIDGE_DIR/config.json"
fi
echo "  Config written to $BRIDGE_DIR/config.json"
echo ""

# -------------------------------------------------------
# Save auth token
# -------------------------------------------------------
echo "[7/8] Auth token..."

if [ -s "$CLAUDE_DIR/.session-token" ]; then
    echo "  Token already configured. Skipping."
else
    echo "  Setting up auth token. This will open your browser."
    echo ""
    claude setup-token
    echo ""
    echo "  Auth token configured."
fi

echo ""

# -------------------------------------------------------
# Install service (launchd on macOS, systemd on Linux)
# -------------------------------------------------------
echo "[8/8] Installing service..."

if [ "$OS" = "Darwin" ]; then
    # macOS — launchd
    PLIST_PATH="$HOME/Library/LaunchAgents/com.nativeclaw.session.plist"
    sed "s|__HOME__|$HOME|g" "$REPO_DIR/launchd/com.nativeclaw.plist.template" > "$PLIST_PATH"
    echo "  Installed launchd service to $PLIST_PATH"
    echo ""

    read -p "  Start NativeClaw now? [y/N]: " START_NOW

    if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
        launchctl load "$PLIST_PATH"
        echo "  NativeClaw is running!"
    else
        echo "  To start later, run:"
        echo "    launchctl load $PLIST_PATH"
    fi

    echo ""
    echo "============================================"
    echo "  Setup complete!"
    echo ""
    echo "  Start:   launchctl load $PLIST_PATH"
    echo "  Stop:    launchctl unload $PLIST_PATH"
    echo "  Restart: launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
    echo "  Logs:    tail -f ~/.claude/logs/telegram-bridge.log"
    echo "============================================"

elif [ "$OS" = "Linux" ]; then
    # Linux — systemd (user service)
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"
    SERVICE_PATH="$SYSTEMD_DIR/nativeclaw.service"
    sed -e "s|__HOME__|$HOME|g" -e "s|__USER__|$(whoami)|g" "$REPO_DIR/systemd/nativeclaw.service.template" > "$SERVICE_PATH"

    # Fix node path for Linux (not /opt/homebrew)
    NODE_PATH=$(which node)
    sed -i "s|/opt/homebrew/bin/node|$NODE_PATH|g" "$SCRIPTS_DIR/claude-restart.sh"

    systemctl --user daemon-reload
    echo "  Installed systemd service to $SERVICE_PATH"
    echo ""

    read -p "  Start NativeClaw now? [y/N]: " START_NOW

    if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
        systemctl --user enable --now nativeclaw.service
        echo "  NativeClaw is running!"
    else
        echo "  To start later, run:"
        echo "    systemctl --user enable --now nativeclaw.service"
    fi

    echo ""
    echo "============================================"
    echo "  Setup complete!"
    echo ""
    echo "  Start:   systemctl --user start nativeclaw"
    echo "  Stop:    systemctl --user stop nativeclaw"
    echo "  Restart: systemctl --user restart nativeclaw"
    echo "  Status:  systemctl --user status nativeclaw"
    echo "  Logs:    tail -f ~/.claude/logs/telegram-bridge.log"
    echo "============================================"

elif [[ "$OS" == MINGW* || "$OS" == MSYS* || "$OS" == CYGWIN* ]]; then
    # Windows — Task Scheduler
    WIN_HOME=$(cygpath -w "$HOME")
    WIN_USERNAME=$(whoami)
    TASK_XML="$SCRIPTS_DIR/nativeclaw-task.xml"

    sed -e "s|__HOME__|$WIN_HOME|g" -e "s|__USERNAME__|$WIN_USERNAME|g" "$REPO_DIR/windows/nativeclaw-task.xml" > "$TASK_XML"

    echo "  Task Scheduler XML written to $TASK_XML"
    echo ""

    read -p "  Register and start NativeClaw task now? [y/N]: " START_NOW

    if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
        WIN_TASK_XML=$(cygpath -w "$TASK_XML")
        schtasks /create /tn "NativeClaw" /xml "$WIN_TASK_XML" /f > /dev/null 2>&1
        if [ $? -eq 0 ]; then
            schtasks /run /tn "NativeClaw" > /dev/null 2>&1
            echo "  NativeClaw is running!"
        else
            echo "  Failed to register task. Try running Git Bash as Administrator."
            echo "  Or register manually:"
            echo "    schtasks /create /tn \"NativeClaw\" /xml \"$WIN_TASK_XML\" /f"
        fi
    else
        echo "  To start later, run in an admin terminal:"
        echo "    schtasks /create /tn \"NativeClaw\" /xml \"$(cygpath -w "$TASK_XML")\" /f"
        echo "    schtasks /run /tn \"NativeClaw\""
    fi

    echo ""
    echo "============================================"
    echo "  Setup complete!"
    echo ""
    echo "  Start:   schtasks /run /tn \"NativeClaw\""
    echo "  Stop:    schtasks /end /tn \"NativeClaw\""
    echo "  Delete:  schtasks /delete /tn \"NativeClaw\" /f"
    echo "  Logs:    type %USERPROFILE%\\.claude\\logs\\telegram-bridge.log"
    echo "============================================"

else
    echo "  Unknown OS: $OS"
    echo "  You'll need to set up the service manually."
    echo "  Run: bash ~/.claude/scripts/claude-restart.sh"
fi

echo ""
echo "  Send a message to your bot on Telegram."
echo "  On first message, your agent will walk you through setting up its personality."
echo ""
