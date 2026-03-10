#!/usr/bin/env bash
set -euo pipefail

# Marks ClaudeCode relay session as active (single-session mode).
# Usage: scripts/claudecode-start.sh

WORKDIR="${HOME}/.openclaw"
STATE_DIR="${WORKDIR}/workspace/data"
STATE_FILE="${STATE_DIR}/claudecode-session.state"

mkdir -p "$STATE_DIR"
if [ -f "$STATE_FILE" ]; then
  echo "ALREADY_RUNNING:claudecode-relay:${WORKDIR}"
  exit 0
fi

printf 'active=1\nstarted_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE_FILE"
echo "STARTED:claudecode-relay:${WORKDIR}"
