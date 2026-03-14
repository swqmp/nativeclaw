#!/bin/bash
# NativeClaw — Session Lifecycle Manager
# Called by launchd/systemd. Starts the Telegram bridge.
# Auth is handled by Claude's keychain credentials (via claude setup-token).

BRIDGE_DIR="$HOME/.claude/telegram-bridge"
BRIDGE_PID_FILE="$BRIDGE_DIR/bridge.pid"
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

# Start the bridge
# Auth is handled automatically by claude -p via keychain credentials.
log "Starting Telegram bridge..."
cd "$BRIDGE_DIR"
nohup node bridge.js >> "$LOG_DIR/telegram-bridge.log" 2>&1 &
sleep 3

if [ -f "$BRIDGE_PID_FILE" ]; then
    log "Bridge started (PID $(cat "$BRIDGE_PID_FILE"))."
else
    log "WARNING: Bridge PID file not created."
fi

log "=== Restart cycle complete. Blocking until next cycle. ==="

# Block forever — service manager handles lifecycle
while true; do
    sleep 3600 &
    wait
done
