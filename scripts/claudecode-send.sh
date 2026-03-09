#!/usr/bin/env bash
set -euo pipefail

# Sends a prompt to a running Claude Code tmux session.
# Usage: scripts/claudecode-send.sh "your full prompt" [session_name]

PROMPT="${1:-}"
SESSION_NAME="${2:-claudecode-relay}"

if [ -z "$PROMPT" ]; then
  echo "ERROR: missing prompt"
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "ERROR: tmux not found"
  exit 1
fi

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "ERROR: session_not_running:$SESSION_NAME"
  exit 1
fi

tmux send-keys -t "$SESSION_NAME" "$PROMPT" Enter

echo "SENT:$SESSION_NAME"
