#!/usr/bin/env bash
set -euo pipefail

# Runs Claude Code prompt relay in ~/.openclaw.
# - First run starts a session.
# - Subsequent runs continue the same session with -c.
# Usage: scripts/claudecode-run.sh "your full prompt"

PROMPT="${1:-}"
WORKDIR="${HOME}/.openclaw"
STATE_DIR="${WORKDIR}/workspace/data"
STATE_FILE="${STATE_DIR}/claudecode-session.state"
LOCK_DIR="${STATE_DIR}/claudecode-session.lock"

if [ -z "$PROMPT" ]; then
  echo "ERROR: missing prompt"
  exit 1
fi

mkdir -p "$STATE_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "ERROR: claudecode_session_busy"
  exit 1
fi
trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT

cd "$WORKDIR"

if [ -f "$STATE_FILE" ]; then
  claude -p -c "$PROMPT"
else
  claude -p "$PROMPT"
  printf 'active=1\nstarted_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE_FILE"
fi
