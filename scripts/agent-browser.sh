#!/bin/bash
# Agent Browser (Chromium) — persistent browser for NativeClaw
# Provides a shared Chromium instance via Chrome DevTools Protocol (CDP)
# All claude -p subprocesses connect to the same browser, so logins/cookies persist.
#
# Usage: agent-browser.sh start | stop | status
#
# Prerequisites:
#   macOS: brew install --cask chromium
#   Linux: sudo apt install chromium-browser (or equivalent)
#   Then clear quarantine on macOS: xattr -cr /Applications/Chromium.app

PROFILE="$HOME/.claude/agent-browser-profile"
PORT=9222
LOG="$HOME/.claude/logs/agent-browser.log"

# Detect Chromium binary
if [[ "$(uname)" == "Darwin" ]]; then
  CHROMIUM="/Applications/Chromium.app/Contents/MacOS/Chromium"
elif command -v chromium-browser &>/dev/null; then
  CHROMIUM="chromium-browser"
elif command -v chromium &>/dev/null; then
  CHROMIUM="chromium"
else
  echo "Chromium not found. Install it first."
  exit 1
fi

case "$1" in
  start)
    if lsof -i :$PORT -t >/dev/null 2>&1; then
      echo "Already running on port $PORT"
      exit 0
    fi
    mkdir -p "$PROFILE"
    "$CHROMIUM" \
      --remote-debugging-port=$PORT \
      --user-data-dir="$PROFILE" \
      --no-first-run \
      --no-default-browser-check \
      > "$LOG" 2>&1 &
    disown
    sleep 2
    if lsof -i :$PORT -t >/dev/null 2>&1; then
      echo "Chromium started on port $PORT (PID: $(lsof -i :$PORT -t))"
    else
      echo "Failed to start — check $LOG"
      exit 1
    fi
    ;;
  stop)
    PIDS=$(lsof -i :$PORT -t 2>/dev/null)
    if [ -z "$PIDS" ]; then
      echo "Not running"
      exit 0
    fi
    kill $PIDS 2>/dev/null
    echo "Stopped"
    ;;
  status)
    if lsof -i :$PORT -t >/dev/null 2>&1; then
      echo "Running on port $PORT (PID: $(lsof -i :$PORT -t))"
    else
      echo "Not running"
    fi
    ;;
  *)
    echo "Usage: agent-browser.sh start|stop|status"
    exit 1
    ;;
esac
