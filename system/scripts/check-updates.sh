#!/bin/bash
# check-updates.sh — Compare installed NativeClaw version against the latest releases.
# Outputs JSON the agent uses to drive the conversational upgrade flow (see UPGRADING.md).
#
# Usage: bash system/scripts/check-updates.sh [VERSION_FILE_PATH]
#
# Exit codes: 0 on success (even when up-to-date), 1 on lookup error.
#
# Requires: jq. Uses gh if available, falls back to curl.

set -e

INSTALLED_VERSION_FILE="${1:-$HOME/.claude/workspace/VERSION}"
REPO="${NATIVECLAW_REPO:-swqmp/nativeclaw}"
SOURCE_CACHE="${NATIVECLAW_SOURCE_CACHE:-$HOME/.nativeclaw-source}"

err_json() {
    printf '{"error": %s}\n' "$(printf '%s' "$1" | jq -Rs . 2>/dev/null || echo "\"$1\"")"
    exit 1
}

# Verify jq
if ! command -v jq >/dev/null 2>&1; then
    echo '{"error": "jq is required. Install with: brew install jq (macOS) or apt-get install jq (Linux)"}' >&2
    exit 1
fi

# Read installed version (default to "unknown" so the agent can still propose a fresh install)
if [ -f "$INSTALLED_VERSION_FILE" ]; then
    installed=$(head -1 "$INSTALLED_VERSION_FILE" | tr -d '[:space:]')
else
    installed="unknown"
fi
[ -z "$installed" ] && installed="unknown"

# Fetch releases
if command -v gh >/dev/null 2>&1; then
    releases=$(gh api "repos/$REPO/releases?per_page=20" 2>/dev/null || echo "")
else
    releases=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" 2>/dev/null || echo "")
fi

if [ -z "$releases" ] || [ "$releases" = "[]" ]; then
    err_json "could not fetch releases from GitHub for $REPO (network down or repo private?)"
fi

# Refresh source cache so the agent can diff against the user's installed tag
mkdir -p "$(dirname "$SOURCE_CACHE")"
cache_status="cache-fresh"
if [ ! -d "$SOURCE_CACHE/.git" ]; then
    if git clone --quiet "https://github.com/$REPO.git" "$SOURCE_CACHE" >/dev/null 2>&1; then
        cache_status="cloned"
    else
        cache_status="clone-failed"
    fi
else
    if (cd "$SOURCE_CACHE" && git fetch --quiet --tags origin >/dev/null 2>&1); then
        cache_status="fetched"
    else
        cache_status="fetch-failed"
    fi
fi

# Emit structured JSON
jq -n \
    --arg installed "$installed" \
    --arg repo "$REPO" \
    --arg cache "$SOURCE_CACHE" \
    --arg cache_status "$cache_status" \
    --argjson releases "$releases" \
    '{
      current_version: $installed,
      repo: $repo,
      source_cache: $cache,
      cache_status: $cache_status,
      releases: ($releases | map({
        tag: .tag_name,
        name: .name,
        published_at: .published_at,
        url: .html_url,
        body: .body
      }))
    }'
