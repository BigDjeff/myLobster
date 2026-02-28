#!/usr/bin/env bash
set -euo pipefail

# spawn-agent.sh — Spawn a coding agent in a tmux session and register it.
#
# Usage: spawn-agent.sh <task-id> <agent-type> <prompt> [--model MODEL] [--branch BRANCH] [--no-notify]
#
# Arguments:
#   task-id     Unique identifier for this task
#   agent-type  One of: claude-opus, claude-sonnet, claude-haiku, codex
#   prompt      The prompt/instruction for the agent (quote it)
#
# Options:
#   --model MODEL     Specific model ID (default: auto from agent-type)
#   --branch BRANCH   Git branch/worktree name
#   --no-notify       Don't send notification on completion
#   --max-retries N   Max retry attempts (default: 3)

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
SCRIPTS_DIR="$WORKSPACE/scripts"
NODE="$(which node)"

# Parse required args
if [ $# -lt 3 ]; then
  echo "Usage: spawn-agent.sh <task-id> <agent-type> <prompt> [options]"
  echo ""
  echo "Agent types: claude-opus, claude-sonnet, claude-haiku, codex"
  exit 1
fi

TASK_ID="$1"
AGENT_TYPE="$2"
PROMPT="$3"
shift 3

# Defaults
MODEL=""
BRANCH=""
NOTIFY=true
MAX_RETRIES=3

# Parse options
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --no-notify) NOTIFY=false; shift ;;
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Auto-resolve model from agent type if not specified
if [ -z "$MODEL" ]; then
  case "$AGENT_TYPE" in
    claude-opus)   MODEL="claude-opus-4-5" ;;
    claude-sonnet) MODEL="claude-sonnet-4-5" ;;
    claude-haiku)  MODEL="claude-haiku-4-5" ;;
    codex)         MODEL="gpt-5.3-codex" ;;
    *) echo "Unknown agent type: $AGENT_TYPE. Use: claude-opus, claude-sonnet, claude-haiku, codex"; exit 1 ;;
  esac
fi

# Sanitize task ID for tmux session name (alphanumeric, hyphens, underscores only)
TMUX_SESSION=$(echo "$TASK_ID" | tr -cd 'a-zA-Z0-9_-')

# Check if session already exists
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "tmux session '$TMUX_SESSION' already exists. Kill it first or use a different task ID."
  exit 1
fi

# Register task in active-tasks.json
$NODE -e "
  const reg = require('$WORKSPACE/shared/task-registry.js');
  const task = reg.addTask({
    id: '$TASK_ID',
    description: $(printf '%s' "$PROMPT" | $NODE -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))"),
    agent: '$AGENT_TYPE',
    model: '$MODEL',
    tmuxSession: '$TMUX_SESSION',
    worktree: '$BRANCH' || null,
    originalPrompt: $(printf '%s' "$PROMPT" | $NODE -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))"),
    maxRetries: $MAX_RETRIES,
    notifyOnComplete: $NOTIFY,
  });
  console.log('Registered task:', task.id);
"

# Build the agent command based on type
AGENT_CMD=""
case "$AGENT_TYPE" in
  claude-opus|claude-sonnet|claude-haiku)
    # Use Claude Code CLI
    AGENT_CMD="cd '$WORKSPACE' && claude -p '$PROMPT' --model '$MODEL' 2>&1 | tee '$BASE_DIR/logs/agent-${TASK_ID}.log'; echo 'AGENT_EXIT_CODE='\$?"
    ;;
  codex)
    # Use OpenAI Codex CLI
    AGENT_CMD="cd '$WORKSPACE' && codex '$PROMPT' 2>&1 | tee '$BASE_DIR/logs/agent-${TASK_ID}.log'; echo 'AGENT_EXIT_CODE='\$?"
    ;;
esac

# If a branch was specified, set up git worktree
if [ -n "$BRANCH" ]; then
  WORKTREE_DIR="$WORKSPACE/.worktrees/$TASK_ID"
  cd "$WORKSPACE"
  if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    git worktree add "$WORKTREE_DIR" -b "$BRANCH" 2>/dev/null || git worktree add "$WORKTREE_DIR" "$BRANCH" 2>/dev/null || true
    # Update agent command to use worktree directory
    AGENT_CMD=$(echo "$AGENT_CMD" | sed "s|cd '$WORKSPACE'|cd '$WORKTREE_DIR'|")
  fi
fi

# Spawn tmux session
tmux new-session -d -s "$TMUX_SESSION" "$AGENT_CMD"

echo "Agent spawned:"
echo "  Task ID:      $TASK_ID"
echo "  Agent:        $AGENT_TYPE"
echo "  Model:        $MODEL"
echo "  tmux session: $TMUX_SESSION"
echo "  Branch:       ${BRANCH:-none}"
echo ""
echo "Monitor:  tmux attach -t $TMUX_SESSION"
echo "Redirect: bash $SCRIPTS_DIR/redirect-agent.sh $TMUX_SESSION '<message>'"
echo "Kill:     bash $SCRIPTS_DIR/kill-agent.sh $TASK_ID"
