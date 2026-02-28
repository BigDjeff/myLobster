#!/usr/bin/env bash
set -euo pipefail

# respawn-agent.sh — Smart respawn: reads failure context, generates improved prompt via LLM,
# and spawns a new agent with the improved prompt.
#
# Usage: respawn-agent.sh <task-id>
#
# Called by check-agents.sh when a task fails and retryCount < maxRetries.

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
TASKS_FILE="$WORKSPACE/data/active-tasks.json"
SCRIPTS_DIR="$WORKSPACE/scripts"
LOG_DIR="$BASE_DIR/logs"
NODE="$(which node)"

if [ $# -lt 1 ]; then
  echo "Usage: respawn-agent.sh <task-id>"
  exit 1
fi

TASK_ID="$1"

# Get task details from registry
TASK_JSON=$(jq ".tasks[] | select(.id == \"$TASK_ID\")" "$TASKS_FILE" 2>/dev/null || echo "")

if [ -z "$TASK_JSON" ]; then
  echo "Task '$TASK_ID' not found in registry."
  exit 1
fi

AGENT=$(echo "$TASK_JSON" | jq -r '.agent // "claude-sonnet"')
MODEL=$(echo "$TASK_JSON" | jq -r '.model // "claude-sonnet-4-5"')
ORIGINAL_PROMPT=$(echo "$TASK_JSON" | jq -r '.originalPrompt // .description')
TMUX_SESSION=$(echo "$TASK_JSON" | jq -r '.tmuxSession // empty')
BRANCH=$(echo "$TASK_JSON" | jq -r '.worktree // empty')
RETRY_COUNT=$(echo "$TASK_JSON" | jq -r '.retryCount // 0')
LAST_ERROR=$(echo "$TASK_JSON" | jq -r '.lastError // "session died unexpectedly"')

# Read the agent's log for failure context
AGENT_LOG="$LOG_DIR/agent-${TASK_ID}.log"
FAILURE_CONTEXT=""
if [ -f "$AGENT_LOG" ]; then
  # Get last 30 lines of the log for context
  FAILURE_CONTEXT=$(tail -30 "$AGENT_LOG" 2>/dev/null || echo "No log output available")
fi

# Generate an improved prompt using the LLM router
IMPROVED_PROMPT=$($NODE -e "
  const { runLlm } = require('$WORKSPACE/shared/llm-router.js');

  const metaPrompt = \`You are an orchestrator improving a failed agent's prompt.

The original task prompt was:
---
${ORIGINAL_PROMPT}
---

The agent failed with this error: ${LAST_ERROR}

Here is the tail of the agent's log output:
---
${FAILURE_CONTEXT}
---

This is retry attempt ${RETRY_COUNT}. Write an improved prompt that:
1. Includes the original task objective
2. Mentions the previous failure and what to avoid
3. Is more specific about file paths and approach
4. Keeps the scope focused

Return ONLY the improved prompt text, nothing else.\`;

  (async () => {
    try {
      const result = await runLlm(metaPrompt, {
        model: 'claude-haiku-4-5',
        caller: 'respawn-agent',
        timeoutMs: 30000,
      });
      process.stdout.write(result.text);
    } catch (err) {
      // Fallback: reuse original prompt with error context prepended
      process.stdout.write('Previous attempt failed: ${LAST_ERROR}. Avoid the same mistake. Original task: ${ORIGINAL_PROMPT}');
    }
  })();
" 2>/dev/null || echo "Previous attempt failed: $LAST_ERROR. Avoid the same mistake. Original task: $ORIGINAL_PROMPT")

# Kill old tmux session if somehow still alive
if [ -n "$TMUX_SESSION" ] && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
fi

# Build the agent command
WORK_DIR="$WORKSPACE"
if [ -n "$BRANCH" ]; then
  WORKTREE_DIR="$WORKSPACE/.worktrees/$TASK_ID"
  if [ -d "$WORKTREE_DIR" ]; then
    WORK_DIR="$WORKTREE_DIR"
  fi
fi

AGENT_CMD=""
case "$AGENT" in
  claude-opus|claude-sonnet|claude-haiku)
    AGENT_CMD="cd '$WORK_DIR' && claude -p $(printf '%s' "$IMPROVED_PROMPT" | jq -Rs .) --model '$MODEL' 2>&1 | tee '$LOG_DIR/agent-${TASK_ID}.log'; echo 'AGENT_EXIT_CODE='\$?"
    ;;
  codex)
    AGENT_CMD="cd '$WORK_DIR' && codex $(printf '%s' "$IMPROVED_PROMPT" | jq -Rs .) 2>&1 | tee '$LOG_DIR/agent-${TASK_ID}.log'; echo 'AGENT_EXIT_CODE='\$?"
    ;;
  *)
    AGENT_CMD="cd '$WORK_DIR' && claude -p $(printf '%s' "$IMPROVED_PROMPT" | jq -Rs .) --model '$MODEL' 2>&1 | tee '$LOG_DIR/agent-${TASK_ID}.log'; echo 'AGENT_EXIT_CODE='\$?"
    ;;
esac

# Respawn in tmux
tmux new-session -d -s "$TMUX_SESSION" "$AGENT_CMD"

# Update registry with the improved prompt
$NODE -e "
  const reg = require('$WORKSPACE/shared/task-registry.js');
  reg.updateTask('$TASK_ID', {
    status: 'running',
    lastError: '$LAST_ERROR',
  });
"

# Log to prompt-patterns.md (failure entry)
PATTERNS_FILE="$WORKSPACE/memory/prompt-patterns.md"
TODAY=$(TZ="Australia/Melbourne" date '+%Y-%m-%d')
{
  echo ""
  echo "### $TODAY"
  echo "- Task: \"$ORIGINAL_PROMPT\" (id: $TASK_ID)"
  echo "  Agent: $AGENT | Model: $MODEL"
  echo "  Retry: $RETRY_COUNT | Error: $LAST_ERROR"
  echo "  Action: Respawned with improved prompt"
} >> "$PATTERNS_FILE"

echo "Respawned task $TASK_ID (attempt $RETRY_COUNT) in tmux session $TMUX_SESSION"
