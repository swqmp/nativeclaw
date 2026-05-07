#!/usr/bin/env bash

#
# NativeClaw v2.0 — Bash install script (macOS/Linux)
# One-command: curl -fsSL https://install.nativeclaw.dev | bash
#

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.nativeclaw}"
BRANCH="${BRANCH:-main}"
SKIP_NODE="${SKIP_NODE:-0}"

info() { echo "⚡  $1" >&2; }
ok()   { echo "✅  $1" >&2; }
warn() { echo "⚠  $1" >&2; }
err()  { echo "❌  $1" >&2; exit 1; }

info "NativeClaw v2.0 Installer"
info "Target: $INSTALL_DIR"

# ── Prereq: Node.js ──
if [ "$SKIP_NODE" = "0" ]; then
  if ! command -v node &>/dev/null; then
    warn "Node.js not found. Attempting install..."
    if command -v brew &>/dev/null; then
      brew install node
    elif command -v apt-get &>/dev/null; then
      sudo apt-get update && sudo apt-get install -y nodejs npm
    else
      err "Install Node.js 18+ manually: https://nodejs.org"
    fi
  fi
  NODE_VER=$(node -v)
  ok "Node.js $NODE_VER"
fi

# ── Prereq: Git ──
if ! command -v git &>/dev/null; then
  err "Git is required. Install via Homebrew, apt, or your package manager."
fi
ok "Git $(git --version)"

# ── Clone / Update ──
if [ ! -d "$INSTALL_DIR/.git" ]; then
  info "Cloning into $INSTALL_DIR..."
  git clone --depth 1 -b "$BRANCH" https://github.com/njdev/nativeclaw.git "$INSTALL_DIR"
else
  info "Updating existing install..."
  (cd "$INSTALL_DIR" && git pull --ff-only)
fi

# ── Build ──
V2="$INSTALL_DIR/v2"
info "Installing dependencies..."
(cd "$V2" && npm install --production)
info "Building TypeScript..."
(cd "$V2" && npm run build)

# ── Symlink CLI ──
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"
ln -sf "$V2/bin/nativeclaw" "$LOCAL_BIN/nativeclaw" || true

if ! echo "$PATH" | grep -q "$LOCAL_BIN"; then
  ok "Add this to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

ok "NativeClaw v2.0 installed at $INSTALL_DIR"
echo ""
echo "Next steps:"
echo "  1. Open a new terminal window (so PATH updates take effect)"
echo "  2. Run: nativeclaw setup"
echo "  3. Follow the prompts to connect Telegram"
echo ""
