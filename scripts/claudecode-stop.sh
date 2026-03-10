#!/usr/bin/env bash
set -euo pipefail

# Stops ClaudeCode relay session (single-session mode).
# Usage: scripts/claudecode-stop.sh

WORKDIR="${HOME}/.openclaw"
STATE_FILE="${WORKDIR}/workspace/data/claudecode-session.state"

if [ -f "$STATE_FILE" ]; then
  rm -f "$STATE_FILE"
  echo "STOPPED:claudecode-relay"
else
  echo "NOT_RUNNING:claudecode-relay"
fi
