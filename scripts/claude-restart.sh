#!/bin/bash
# NativeClaw — Session Lifecycle Manager
# Called by launchd (macOS) / systemd (Linux). Starts and supervises the Telegram bridge.
# Auth is handled by Claude's keychain credentials (via claude setup-token).

BRIDGE_DIR="$HOME/.claude/telegram-bridge"
BRIDGE_PID_FILE="$BRIDGE_DIR/bridge.pid"
LOG_DIR="$HOME/.claude/logs"
LOG="$LOG_DIR/restart.log"

# Supervisor tunables
BRIDGE_PID_WAIT_SEC=15        # how long to wait after spawn for bridge to write its PID file
MAX_FAILED_STARTS=5           # consecutive failed starts before giving up (then launchd takes over)
BACKOFF_BASE_SEC=10           # linear backoff multiplier
BACKOFF_MAX_SEC=60            # cap

mkdir -p "$LOG_DIR"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

stop_bridge() {
    if [ -f "$BRIDGE_PID_FILE" ]; then
        BPID=$(cat "$BRIDGE_PID_FILE")
        if kill -0 "$BPID" 2>/dev/null; then
            log "Stopping bridge (PID $BPID)..."
            kill "$BPID" 2>/dev/null
            for i in $(seq 1 10); do
                kill -0 "$BPID" 2>/dev/null || break
                sleep 1
            done
            kill -0 "$BPID" 2>/dev/null && kill -9 "$BPID" 2>/dev/null
            log "Bridge stopped."
        fi
        rm -f "$BRIDGE_PID_FILE"
    fi
}

cleanup() {
    log "SIGTERM received — cleaning up..."
    stop_bridge
    log "Cleanup complete. Exiting 1."
    exit 1
}

trap cleanup SIGTERM SIGINT

# Spawn the bridge once. Returns 0 if PID file appears within BRIDGE_PID_WAIT_SEC, else 1.
start_bridge_once() {
    cd "$BRIDGE_DIR" || return 1
    nohup node bridge.js >> "$LOG_DIR/telegram-bridge.log" 2>&1 &
    for i in $(seq 1 $BRIDGE_PID_WAIT_SEC); do
        if [ -f "$BRIDGE_PID_FILE" ]; then
            return 0
        fi
        sleep 1
    done
    return 1
}

log "=== Restart cycle triggered ==="
stop_bridge

# Supervisor loop:
# - Healthy bridge dies → respawn after short delay (no failure counter bump).
# - Bridge fails to write PID (cold-boot network race, etc.) → respawn with linear backoff.
# - After MAX_FAILED_STARTS in a row, exit non-zero so launchd's KeepAlive triggers a full agent restart.
FAILED_STARTS=0
while true; do
    if start_bridge_once; then
        BPID=$(cat "$BRIDGE_PID_FILE" 2>/dev/null)
        if [ -z "$BPID" ]; then
            log "WARNING: PID file disappeared between check and read."
            FAILED_STARTS=$((FAILED_STARTS + 1))
        else
            log "Bridge started (PID $BPID)."
            FAILED_STARTS=0
            while kill -0 "$BPID" 2>/dev/null; do
                sleep 10
            done
            log "Bridge process (PID $BPID) died — will respawn."
            rm -f "$BRIDGE_PID_FILE"
        fi
    else
        FAILED_STARTS=$((FAILED_STARTS + 1))
        log "WARNING: Bridge failed to write PID within ${BRIDGE_PID_WAIT_SEC}s (attempt $FAILED_STARTS/$MAX_FAILED_STARTS)."
    fi

    if [ $FAILED_STARTS -ge $MAX_FAILED_STARTS ]; then
        log "FATAL: Bridge failed $FAILED_STARTS consecutive times. Exiting to trigger launchd restart."
        exit 1
    fi

    if [ $FAILED_STARTS -gt 0 ]; then
        BACKOFF=$((BACKOFF_BASE_SEC * FAILED_STARTS))
        [ $BACKOFF -gt $BACKOFF_MAX_SEC ] && BACKOFF=$BACKOFF_MAX_SEC
    else
        BACKOFF=5
    fi
    log "Sleeping ${BACKOFF}s before next attempt..."
    sleep $BACKOFF
done
