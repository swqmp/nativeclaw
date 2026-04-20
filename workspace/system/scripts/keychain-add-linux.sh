#!/usr/bin/env bash
# keychain-add-linux.sh — store a secret in the Linux Secret Service (libsecret).
# Usage: keychain-add-linux.sh <KEY_NAME>
#   Prompts (stdin, no echo) for the value, stores it, verifies retrieval.
#
# Requires: secret-tool (package: libsecret-tools on Debian/Ubuntu,
# libsecret on Arch, gnome-keyring on Fedora).
#
# Paired with mcp-wrapper.js --keychain-env. On Linux, extend the wrapper
# loadKeychainEnv to fetch via:
#   secret-tool lookup service <KEY_NAME> account "$NATIVECLAW_KEYCHAIN_ACCOUNT"
# (The current wrapper defaults to macOS `security`. Linux support is a
# small addition — see workspace/system/mcp-health/mcp-wrapper.js.)
set -u

if ! command -v secret-tool >/dev/null 2>&1; then
  echo "secret-tool not installed. Install libsecret-tools (or your distro's equivalent)." >&2
  echo "  Debian/Ubuntu: sudo apt install libsecret-tools" >&2
  echo "  Arch:          sudo pacman -S libsecret" >&2
  echo "  Fedora:        sudo dnf install libsecret" >&2
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

# Store (may prompt for keyring unlock on first use)
printf '%s' "$VAL" | secret-tool store --label="nativeclaw $KEY" service "$KEY" account "$ACCOUNT" || {
  echo "secret-tool store failed — is the keyring service running (gnome-keyring-daemon)?" >&2
  exit 1
}

ROUND=$(secret-tool lookup service "$KEY" account "$ACCOUNT" 2>/dev/null || true)
if [[ "$ROUND" != "$VAL" ]]; then
  echo "verification FAILED: round-trip mismatch" >&2
  exit 1
fi

echo "stored $KEY (len=${#VAL}) under account=$ACCOUNT and verified round-trip"
echo ""
echo "Retrieval snippet:"
echo "  secret-tool lookup service $KEY account \"\$NATIVECLAW_KEYCHAIN_ACCOUNT\""
