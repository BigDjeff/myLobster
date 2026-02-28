#!/usr/bin/env bash
set -euo pipefail

# redirect-agent.sh — Send a mid-task correction to a running agent's tmux session.
#
# Usage: redirect-agent.sh <session-name> <message>
#
# This types the message into the agent's terminal as if a human typed it,
# allowing mid-task course correction without killing the agent.

if [ $# -lt 2 ]; then
  echo "Usage: redirect-agent.sh <session-name> <message>"
  echo ""
  echo "Example: redirect-agent.sh feat-templates 'Stop. Focus on the API layer first.'"
  exit 1
fi

SESSION_NAME="$1"
shift
MESSAGE="$*"

# Verify session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "No tmux session named '$SESSION_NAME' found."
  echo ""
  echo "Active sessions:"
  tmux list-sessions 2>/dev/null || echo "  (none)"
  exit 1
fi

# Send the message as keystrokes into the session
tmux send-keys -t "$SESSION_NAME" "$MESSAGE" Enter

echo "Message sent to session '$SESSION_NAME':"
echo "  $MESSAGE"
