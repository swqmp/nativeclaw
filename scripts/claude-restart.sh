#!/bin/bash
# NativeClaw — Session Lifecycle Manager
# Called by launchd every 71 hours (before 72-hour session expiry)
# Reads auth token from file, starts the Telegram bridge

BRIDGE_DIR="$HOME/.claude/telegram-bridge"
BRIDGE_PID_FILE="$BRIDGE_DIR/bridge.pid"
TOKEN_FILE="$HOME/.claude/.session-token"
LOG_DIR="$HOME/.claude/logs"
LOG="$LOG_DIR/restart.log"

export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

cleanup() {
    log "SIGTERM received — cleaning up..."

    if [ -f "$BRIDGE_PID_FILE" ]; then
        BPID=$(cat "$BRIDGE_PID_FILE")
        if kill -0 "$BPID" 2>/dev/null; then
            kill "$BPID" 2>/dev/null
            sleep 3
            kill -0 "$BPID" 2>/dev/null && kill -9 "$BPID" 2>/dev/null
        fi
        rm -f "$BRIDGE_PID_FILE"
    fi

    log "Cleanup complete. Exiting 0."
    exit 0
}

trap cleanup SIGTERM SIGINT

log "=== Restart cycle triggered ==="

# Stop any existing bridge
if [ -f "$BRIDGE_PID_FILE" ]; then
    BPID=$(cat "$BRIDGE_PID_FILE")
    if kill -0 "$BPID" 2>/dev/null; then
        log "Stopping old bridge (PID $BPID)..."
        kill "$BPID" 2>/dev/null
        for i in $(seq 1 10); do
            kill -0 "$BPID" 2>/dev/null || break
            sleep 1
        done
        kill -0 "$BPID" 2>/dev/null && kill -9 "$BPID" 2>/dev/null
        log "Old bridge stopped."
    fi
    rm -f "$BRIDGE_PID_FILE"
fi

# Read auth token
if [ ! -f "$TOKEN_FILE" ]; then
    log "ERROR: No auth token file at $TOKEN_FILE"
    log "Fix: Run this from a terminal where Claude is authenticated:"
    log "  echo \"\$CLAUDE_CODE_SESSION_ACCESS_TOKEN\" > $TOKEN_FILE && chmod 600 $TOKEN_FILE"
    while true; do sleep 3600 & wait; done
fi

TOKEN=$(cat "$TOKEN_FILE" | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then
    log "ERROR: Auth token file is empty."
    while true; do sleep 3600 & wait; done
fi

log "Auth token loaded from $TOKEN_FILE"

# Start the bridge
log "Starting Telegram bridge..."
cd "$BRIDGE_DIR"
CLAUDE_CODE_SESSION_ACCESS_TOKEN="$TOKEN" nohup /opt/homebrew/bin/node bridge.js >> "$LOG_DIR/telegram-bridge.log" 2>&1 &
sleep 3

if [ -f "$BRIDGE_PID_FILE" ]; then
    log "Bridge started (PID $(cat "$BRIDGE_PID_FILE"))."
else
    log "WARNING: Bridge PID file not created."
fi

log "=== Restart cycle complete. Blocking until next cycle. ==="

# Block forever — launchd manages lifecycle via SIGTERM + StartInterval
while true; do
    sleep 3600 &
    wait
done
