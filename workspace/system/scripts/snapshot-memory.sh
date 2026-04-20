#!/bin/bash
# Memory snapshot — backup MEMORY.md at session start.
# Creates a timestamped copy so bad overwrites can be rolled back.
# Keeps the last 30 snapshots.

set -u

WORKSPACE="${NATIVECLAW_WORKSPACE:-$HOME/.claude/workspace}"
MEMORY_FILE="$WORKSPACE/MEMORY.md"
SNAPSHOT_DIR="$WORKSPACE/memory/snapshots"

TIMESTAMP=$(date +%Y-%m-%d_%H%M)

mkdir -p "$SNAPSHOT_DIR"

if [ ! -f "$MEMORY_FILE" ]; then
  echo "No MEMORY.md found at $MEMORY_FILE"
  exit 0
fi

cp "$MEMORY_FILE" "$SNAPSHOT_DIR/MEMORY_${TIMESTAMP}.md"

# Retain only the last 30
ls -t "$SNAPSHOT_DIR"/MEMORY_*.md 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null

TOTAL=$(ls "$SNAPSHOT_DIR"/MEMORY_*.md 2>/dev/null | wc -l | tr -d ' ')
echo "Memory snapshot saved: MEMORY_${TIMESTAMP}.md (${TOTAL} total)"
