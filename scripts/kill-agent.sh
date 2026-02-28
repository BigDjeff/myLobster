#!/usr/bin/env bash
set -euo pipefail

# kill-agent.sh — Kill an agent's tmux session and update the task registry.
#
# Usage: kill-agent.sh <task-id>

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
NODE="$(which node)"

if [ $# -lt 1 ]; then
  echo "Usage: kill-agent.sh <task-id>"
  exit 1
fi

TASK_ID="$1"

# Look up the tmux session from the task registry
TASKS_FILE="$WORKSPACE/data/active-tasks.json"
TMUX_SESSION=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .tmuxSession // empty" "$TASKS_FILE" 2>/dev/null || echo "")

if [ -z "$TMUX_SESSION" ]; then
  echo "Task '$TASK_ID' not found in registry or has no tmux session."
  exit 1
fi

# Kill the tmux session
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$TMUX_SESSION"
  echo "Killed tmux session: $TMUX_SESSION"
else
  echo "tmux session '$TMUX_SESSION' was already dead."
fi

# Update task registry
$NODE -e "
  const reg = require('$WORKSPACE/shared/task-registry.js');
  reg.updateTask('$TASK_ID', {
    status: 'killed',
    completedAt: Date.now(),
    error: 'Manually killed',
  });
  console.log('Task $TASK_ID marked as killed in registry.');
"
