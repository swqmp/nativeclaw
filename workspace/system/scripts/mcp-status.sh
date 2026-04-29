#!/usr/bin/env bash
# MCP criticality + live health status.
# Reads mcp-criticality.json (static tier map) + last-probe.json (latest probe
# results from probe.js) and prints an actionable status table.
#
# Flags:
#   --quiet  suppress output when all critical MCPs are healthy and probe is
#            fresh. Intended for session-start checks — silent on green, loud
#            on broken.
set -euo pipefail

QUIET=0
if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=1
fi

ROOT="${NATIVECLAW_WORKSPACE:-$HOME/.claude/workspace}"
MAP="$ROOT/system/mcp-health/mcp-criticality.json"
MCP_JSON="$ROOT/.mcp.json"
PROBE="$ROOT/system/mcp-health/last-probe.json"

if [[ ! -f "$MAP" ]]; then
  echo "missing: $MAP" >&2
  exit 1
fi

exec python3 - "$MAP" "$MCP_JSON" "$PROBE" "$QUIET" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone

map_path, mcp_path, probe_path, quiet_flag = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
quiet = quiet_flag == "1"
mapping = json.load(open(map_path))
raw_configured = set(json.load(open(mcp_path)).get("mcpServers", {}).keys())
configured = {name for name in raw_configured if not name.startswith("__")}
servers = mapping["servers"]

probe = None
probe_age = None
if os.path.exists(probe_path):
    probe = json.load(open(probe_path))
    try:
        probed_at = datetime.fromisoformat(probe["probed_at"].replace("Z", "+00:00"))
        probe_age = datetime.now(timezone.utc) - probed_at
    except Exception:
        pass

tier_order = {"critical": 0, "important": 1, "optional": 2}
rows = sorted(
    servers.items(),
    key=lambda kv: (tier_order.get(kv[1]["tier"], 9), kv[0])
)

STALE_MIN = 120  # probe older than this triggers warning in --quiet mode

critical_failures = []
for name, info in rows:
    if info["tier"] != "critical":
        continue
    probe_entry = (probe or {}).get("servers", {}).get(name)
    if probe_entry and probe_entry["status"] == "ok":
        continue
    status = probe_entry["status"] if probe_entry else ("unknown" if probe else "not-probed")
    detail = probe_entry.get("detail", "") if probe_entry else ""
    critical_failures.append((name, status, detail))

required_tiers = {"critical", "important"}
missing_from_config = [
    n for n, info in servers.items()
    if info["tier"] in required_tiers and n not in configured
]
unmapped = [n for n in configured if n not in servers]

probe_missing = probe is None
probe_stale = probe_age is not None and (probe_age.total_seconds() / 60) > STALE_MIN

if quiet:
    any_issue = critical_failures or missing_from_config or unmapped or probe_missing or probe_stale
    if not any_issue:
        sys.exit(0)
    if probe_missing:
        print("WARNING: no probe on record. Run: node system/mcp-health/probe.js")
    elif probe_stale:
        mins = int(probe_age.total_seconds() / 60)
        print(f"WARNING: probe stale ({mins} min ago). Run: node system/mcp-health/probe.js")
    if critical_failures:
        print(f"CRITICAL MCP FAILURES ({len(critical_failures)}) — escalate to user:")
        for name, status, detail in critical_failures:
            print(f"  - {name}: {status} — {detail}")
    if missing_from_config:
        print(f"WARNING: {len(missing_from_config)} mapped server(s) not in .mcp.json: {missing_from_config}")
    if unmapped:
        print(f"WARNING: {len(unmapped)} configured server(s) not in criticality map: {unmapped}")
    sys.exit(0)

# verbose mode
if probe:
    age_str = "unknown"
    if probe_age is not None:
        total_min = probe_age.total_seconds() / 60
        if total_min < 60:
            age_str = f"{int(total_min)} min ago"
        else:
            age_str = f"{total_min/60:.1f} hr ago"
    print(f"Last probe: {probe['probed_at']} ({age_str})")
else:
    print("Last probe: NEVER RUN (run: node system/mcp-health/probe.js)")
print()

print(f"{'MCP':<22} {'TIER':<10} {'PROBE':<10} {'MS':<6} PURPOSE")
print("-" * 100)
for name, info in rows:
    tier = info["tier"]
    probe_entry = (probe or {}).get("servers", {}).get(name)
    if probe_entry:
        status = probe_entry["status"]
        elapsed = f"{probe_entry.get('elapsed_ms', 0)}"
    else:
        status = "not-probed" if tier == "optional" else "unknown"
        elapsed = "-"
    print(f"{name:<22} {tier:<10} {status:<10} {elapsed:<6} {info['purpose']}")
    fb = info.get("fallback", "")
    if status != "ok" and probe_entry:
        print(f"{'':<44} last detail: {probe_entry.get('detail', '')}")
    if fb == "none":
        print(f"{'':<44} fallback: NONE -- workflow blocks if down")
    elif fb:
        print(f"{'':<44} fallback: {fb}")

if missing_from_config:
    print()
    print(f"WARNING: {len(missing_from_config)} mapped server(s) not in .mcp.json: {missing_from_config}")

if unmapped:
    print()
    print(f"WARNING: {len(unmapped)} configured server(s) not in criticality map: {unmapped}")

if critical_failures:
    print()
    print(f"CRITICAL FAILURES ({len(critical_failures)}) — escalate to user for restart:")
    for name, status, detail in critical_failures:
        print(f"  - {name}: {status} — {detail}")

tier_counts = {"critical": 0, "important": 0, "optional": 0}
for info in servers.values():
    tier_counts[info["tier"]] += 1
print()
print(f"Totals: {tier_counts['critical']} critical, {tier_counts['important']} important, {tier_counts['optional']} optional")
PYEOF
