#!/usr/bin/env bash
# Scan files for leaked API key patterns. Exits non-zero on finding.
# Usage: scan-secrets.sh [path...]
#   default path: workspace root (excluding .secrets/, .git, node_modules, logs,
#   backups, playwright caches, qmd/nanobanana binary indexes)
# Logs findings to ~/.claude/logs/secrets-scan.log and stdout.
set -u

LOG=${HOME}/.claude/logs/secrets-scan.log
mkdir -p "$(dirname "$LOG")"

ROOTS=("$@")
if [[ ${#ROOTS[@]} -eq 0 ]]; then
  ROOTS=("${NATIVECLAW_WORKSPACE:-$HOME/.claude/workspace}")
fi

# Patterns. Each line: <label>|<regex>
# Keep surgical -- only formats with strong signal-to-noise.
read -r -d '' PATTERNS <<'PATS'
google-api-key|AIza[0-9A-Za-z_-]{35}
anthropic-key|sk-ant-(api|admin|user)[0-9a-zA-Z_-]{20,}
openai-key|sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}
stripe-live|(sk|rk|pk)_live_[0-9a-zA-Z]{24,}
stripe-test|(sk|rk|pk)_test_[0-9a-zA-Z]{24,}
github-pat|gh[opsu]_[A-Za-z0-9]{36,}
aws-access|AKIA[0-9A-Z]{16}
slack-token|xox[baprs]-[0-9A-Za-z-]{10,}
private-key-block|-----BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----
jwt|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}
PATS

# Exclude paths. Aggressive by default — we scan human-authored text, not vendored code.
EXCLUDES=(
  --exclude-dir=.git
  --exclude-dir=node_modules
  --exclude-dir=.secrets
  --exclude-dir=logs
  --exclude-dir=.playwright-mcp
  --exclude-dir=snapshots
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=coverage
  --exclude-dir=tests
  --exclude-dir=test
  --exclude-dir=__tests__
  --exclude-dir=vendor
  --exclude-dir=.venv
  --exclude-dir=venv
  --exclude="*.bak-*"
  --exclude="*.log"
  --exclude="*.min.js"
  --exclude="*.map"
  --exclude="last-probe.json"
  --exclude="index.json"
  -I  # skip binary files
)

# Optional allowlist from .secretsignore (one glob per line). Matches full path.
IGNORE_FILE="${NATIVECLAW_WORKSPACE:-$HOME/.claude/workspace}/.secretsignore"
IGNORE_GLOBS=()
if [[ -f "$IGNORE_FILE" ]]; then
  while IFS= read -r pat; do
    [[ -z "$pat" || "${pat:0:1}" == "#" ]] && continue
    IGNORE_GLOBS+=("$pat")
  done < "$IGNORE_FILE"
fi

path_ignored() {
  local p="$1"
  for glob in "${IGNORE_GLOBS[@]:-}"; do
    [[ -z "$glob" ]] && continue
    case "$p" in $glob) return 0 ;; esac
  done
  return 1
}

findings=0
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

while IFS='|' read -r label regex; do
  [[ -z "${label:-}" ]] && continue
  out=$(grep -rEn "$regex" "${EXCLUDES[@]}" "${ROOTS[@]}" 2>/dev/null || true)
  if [[ -n "$out" ]]; then
    while IFS= read -r line; do
      # grep -rEn output is "path:lineno:match"; pull path for allowlist check
      filepath="${line%%:*}"
      case "$filepath" in
        */.secrets/README.md) continue ;;
        */scan-secrets.sh) continue ;;
      esac
      if path_ignored "$filepath"; then continue; fi
      findings=$((findings + 1))
      redacted=$(echo "$line" | sed -E "s/($regex)/[REDACTED-$label]/g")
      echo "$redacted"
      echo "$TS HIT $label $redacted" >> "$LOG"
    done <<< "$out"
  fi
done <<< "$PATTERNS"

if [[ $findings -eq 0 ]]; then
  echo "$TS OK no-findings roots=${ROOTS[*]}" >> "$LOG"
  exit 0
fi

echo ""
echo "FOUND $findings secret-like pattern(s). Details logged to $LOG"
exit 1
