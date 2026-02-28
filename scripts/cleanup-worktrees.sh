#!/usr/bin/env bash
set -euo pipefail

# cleanup-worktrees.sh — Prune completed/failed worktrees and stale task registry entries.
# Runs daily at 3am. Retention policy: 24 hours after completion.

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
TASKS_FILE="$WORKSPACE/data/active-tasks.json"

if [ ! -f "$TASKS_FILE" ]; then
  echo "No task registry found. Nothing to clean."
  exit 0
fi

cd "$WORKSPACE"

NOW_MS=$(date +%s)000
RETENTION_MS=86400000  # 24 hours in milliseconds

CLEANED=0

# Find tasks that are done/failed/killed and older than 24 hours
STALE_TASKS=$(jq -r ".tasks[] | select((.status == \"done\" or .status == \"failed\" or .status == \"killed\") and .completedAt != null and .notified == true and (.completedAt + $RETENTION_MS) < $NOW_MS) | .id" "$TASKS_FILE" 2>/dev/null || echo "")

for TASK_ID in $STALE_TASKS; do
  [ -z "$TASK_ID" ] && continue

  WORKTREE=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .worktree // empty" "$TASKS_FILE")
  WORKTREE_DIR="$WORKSPACE/.worktrees/$TASK_ID"

  # Remove git worktree if it exists
  if [ -d "$WORKTREE_DIR" ] && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
    echo "Removed worktree: $WORKTREE_DIR"
  fi

  # Remove agent log
  AGENT_LOG="$BASE_DIR/logs/agent-${TASK_ID}.log"
  if [ -f "$AGENT_LOG" ]; then
    rm "$AGENT_LOG"
    echo "Removed log: $AGENT_LOG"
  fi

  # Remove task from registry
  jq "del(.tasks[] | select(.id == \"$TASK_ID\"))" "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
  echo "Removed stale task: $TASK_ID"
  CLEANED=$((CLEANED + 1))
done

# Prune any orphaned git worktrees
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  git worktree prune 2>/dev/null || true
fi

# Clean up empty .worktrees directory
if [ -d "$WORKSPACE/.worktrees" ] && [ -z "$(ls -A "$WORKSPACE/.worktrees" 2>/dev/null)" ]; then
  rmdir "$WORKSPACE/.worktrees" 2>/dev/null || true
fi

echo "Cleanup complete. Removed $CLEANED stale task(s)."
