#!/usr/bin/env bash
set -euo pipefail

# Captures the visible Claude Code terminal buffer from tmux.
# Usage: scripts/claudecode-capture.sh [session_name]

SESSION_NAME="${1:-claudecode-relay}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "ERROR: tmux not found"
  exit 1
fi

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "ERROR: session_not_running:$SESSION_NAME"
  exit 1
fi

tmux capture-pane -t "$SESSION_NAME" -p
