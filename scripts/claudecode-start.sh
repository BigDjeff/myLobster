#!/usr/bin/env bash
set -euo pipefail

# Starts a persistent Claude Code tmux session in ~/.openclaw.
# Usage: scripts/claudecode-start.sh [session_name]

SESSION_NAME="${1:-claudecode-relay}"
WORKDIR="${HOME}/.openclaw"

if ! command -v tmux >/dev/null 2>&1; then
  echo "ERROR: tmux not found"
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "ALREADY_RUNNING:$SESSION_NAME"
  exit 0
fi

tmux new-session -d -s "$SESSION_NAME" -c "$WORKDIR" "claude"
echo "STARTED:$SESSION_NAME:$WORKDIR"
