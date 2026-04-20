#!/usr/bin/env bash
# keychain-add.sh — store a secret in the macOS login keychain.
# Usage: keychain-add.sh <KEY_NAME>
#   Prompts (stdin, no echo) for the value, stores it, verifies retrieval.
# Paired with mcp-wrapper.js --keychain-env, which fetches via:
#   security find-generic-password -a "$NATIVECLAW_KEYCHAIN_ACCOUNT" -s <KEY_NAME> -w
set -u

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is macOS-only. Use keychain-add-linux.sh on Linux." >&2
  exit 2
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <KEY_NAME>" >&2
  exit 2
fi

KEY="$1"
ACCOUNT="${NATIVECLAW_KEYCHAIN_ACCOUNT:-$USER}"

if ! [[ "$KEY" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
  echo "refusing to store key with non-env name: $KEY" >&2
  echo "expected pattern: ^[A-Z_][A-Z0-9_]*$" >&2
  exit 2
fi

printf 'Paste value for %s (input hidden), then Enter: ' "$KEY"
IFS= read -rs VAL
echo

if [[ -z "$VAL" ]]; then
  echo "empty value, aborting" >&2
  exit 1
fi

/usr/bin/security add-generic-password -U -a "$ACCOUNT" -s "$KEY" -w "$VAL" || {
  echo "security add-generic-password failed" >&2
  exit 1
}

ROUND=$(/usr/bin/security find-generic-password -a "$ACCOUNT" -s "$KEY" -w 2>/dev/null || true)
if [[ "$ROUND" != "$VAL" ]]; then
  echo "verification FAILED: round-trip mismatch" >&2
  exit 1
fi

echo "stored $KEY (len=${#VAL}) under account=$ACCOUNT and verified round-trip"
echo ""
echo "To wire into .mcp.json, wrap the MCP with:"
echo "  \"command\": \"node\","
echo "  \"args\": ["
echo "    \"PATH_TO_WORKSPACE/system/mcp-health/mcp-wrapper.js\","
echo "    \"--keychain-env\", \"$KEY\","
echo "    \"<mcp-name>\", \"<real-cmd>\", \"<args...>\""
echo "  ]"
echo "Then remove $KEY from the MCP's env block."
