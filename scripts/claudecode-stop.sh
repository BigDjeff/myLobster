#!/usr/bin/env bash
set -euo pipefail

# Stops a persistent Claude Code tmux session.
# Usage: scripts/claudecode-stop.sh [session_name]

SESSION_NAME="${1:-claudecode-relay}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "ERROR: tmux not found"
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux kill-session -t "$SESSION_NAME"
  echo "STOPPED:$SESSION_NAME"
else
  echo "NOT_RUNNING:$SESSION_NAME"
fi
