#!/usr/bin/env bash
set -euo pipefail

# check-agents.sh — Monitor running agents, detect failures, handle notifications.
# Runs every 10 minutes via cron. Zero LLM tokens used (pure bash + jq).

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
TASKS_FILE="$WORKSPACE/data/active-tasks.json"
SCRIPTS_DIR="$WORKSPACE/scripts"
LOG_DIR="$BASE_DIR/logs"
NODE="$(which node)"
BOT_TOKEN=$(jq -r '.channels.telegram.botToken' "$BASE_DIR/openclaw.json")
CHAT_ID="5014458510"

# Exit early if no tasks file
if [ ! -f "$TASKS_FILE" ]; then
  exit 0
fi

# Read all tasks with status "running"
RUNNING_TASKS=$(jq -r '.tasks[] | select(.status == "running") | .id' "$TASKS_FILE" 2>/dev/null || echo "")

NEEDS_ATTENTION=""
COMPLETED_TASKS=""

for TASK_ID in $RUNNING_TASKS; do
  [ -z "$TASK_ID" ] && continue

  # Get task details
  TMUX_SESSION=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .tmuxSession // empty" "$TASKS_FILE")
  BRANCH=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .worktree // empty" "$TASKS_FILE")
  RETRY_COUNT=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .retryCount // 0" "$TASKS_FILE")
  MAX_RETRIES=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .maxRetries // 3" "$TASKS_FILE")
  DESCRIPTION=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .description // empty" "$TASKS_FILE")

  # CHECK 1: Is the tmux session still alive?
  if [ -n "$TMUX_SESSION" ]; then
    if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
      # Session is dead. Check the agent's log for exit status.
      AGENT_LOG="$LOG_DIR/agent-${TASK_ID}.log"
      EXIT_CODE=""
      if [ -f "$AGENT_LOG" ]; then
        EXIT_CODE=$(grep -o 'AGENT_EXIT_CODE=[0-9]*' "$AGENT_LOG" | tail -1 | cut -d= -f2 || echo "")
      fi

      if [ "$EXIT_CODE" = "0" ]; then
        # Agent completed successfully
        jq "(.tasks[] | select(.id == \"$TASK_ID\") | .status) = \"done\" | (.tasks[] | select(.id == \"$TASK_ID\") | .completedAt) = $(date +%s)000" \
          "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
        COMPLETED_TASKS="${COMPLETED_TASKS}- ${DESCRIPTION:-$TASK_ID} (completed)\n"
      else
        # Agent failed or crashed
        LAST_ERROR=""
        if [ -f "$AGENT_LOG" ]; then
          LAST_ERROR=$(tail -5 "$AGENT_LOG" | head -3 || echo "unknown error")
        fi

        if [ "$RETRY_COUNT" -lt "$MAX_RETRIES" ]; then
          # Auto-respawn
          jq "(.tasks[] | select(.id == \"$TASK_ID\") | .retryCount) += 1 | (.tasks[] | select(.id == \"$TASK_ID\") | .lastError) = \"session died\"" \
            "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"

          # Attempt respawn
          if [ -x "$SCRIPTS_DIR/respawn-agent.sh" ]; then
            bash "$SCRIPTS_DIR/respawn-agent.sh" "$TASK_ID" 2>/dev/null || true
          fi

          NEEDS_ATTENTION="${NEEDS_ATTENTION}Task $TASK_ID: session died, respawning (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)\n"
        else
          # Max retries hit. Mark as failed.
          jq "(.tasks[] | select(.id == \"$TASK_ID\") | .status) = \"failed\" | (.tasks[] | select(.id == \"$TASK_ID\") | .error) = \"Exceeded max retries ($MAX_RETRIES). Last error: session died.\"" \
            "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
          NEEDS_ATTENTION="${NEEDS_ATTENTION}FAILED: Task $TASK_ID ($DESCRIPTION) exceeded max retries. Needs human attention.\n"
        fi
      fi
    fi
  fi

  # CHECK 2: Is there an open PR for this branch? (only if GitHub is set up)
  if command -v gh &>/dev/null && [ -n "$BRANCH" ]; then
    PR_STATE=$(gh pr view "$BRANCH" --json state --jq '.state' 2>/dev/null || echo "NONE")
    if [ "$PR_STATE" = "MERGED" ]; then
      jq "(.tasks[] | select(.id == \"$TASK_ID\") | .status) = \"done\" | (.tasks[] | select(.id == \"$TASK_ID\") | .completedAt) = $(date +%s)000" \
        "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
      COMPLETED_TASKS="${COMPLETED_TASKS}- ${DESCRIPTION:-$TASK_ID} (PR merged)\n"
    fi
  fi

  # CHECK 3: CI status (only if GitHub is set up)
  if command -v gh &>/dev/null && [ -n "$BRANCH" ]; then
    CI_STATUS=$(gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion' 2>/dev/null || echo "unknown")
    if [ "$CI_STATUS" = "failure" ]; then
      NEEDS_ATTENTION="${NEEDS_ATTENTION}Task $TASK_ID: CI failed on branch $BRANCH\n"
    fi
  fi
done

# Handle "Ready for Review" notifications — check for completed but unnotified tasks
UNNOTIFIED=$(jq -r '.tasks[] | select((.status == "done" or .status == "failed") and .notified != true and .notifyOnComplete == true) | .id' "$TASKS_FILE" 2>/dev/null || echo "")

NOTIFY_MSG=""

for TASK_ID in $UNNOTIFIED; do
  [ -z "$TASK_ID" ] && continue
  STATUS=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .status" "$TASKS_FILE")
  DESCRIPTION=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .description // \"(no description)\"" "$TASKS_FILE")

  if [ "$STATUS" = "done" ]; then
    NOTIFY_MSG="${NOTIFY_MSG}✓ ${DESCRIPTION}\n"
  elif [ "$STATUS" = "failed" ]; then
    ERROR=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .error // \"unknown\"" "$TASKS_FILE")
    NOTIFY_MSG="${NOTIFY_MSG}✗ ${DESCRIPTION}: ${ERROR}\n"
  fi

  # Mark as notified
  jq "(.tasks[] | select(.id == \"$TASK_ID\") | .notified) = true" \
    "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
done

# Send consolidated Telegram notification
FULL_MSG=""

if [ -n "$NOTIFY_MSG" ]; then
  FULL_MSG="Task Report:\n${NOTIFY_MSG}"
fi

if [ -n "$NEEDS_ATTENTION" ]; then
  FULL_MSG="${FULL_MSG}\nNeeds Attention:\n${NEEDS_ATTENTION}"
fi

if [ -n "$FULL_MSG" ]; then
  TELEGRAM_TEXT=$(echo -e "$FULL_MSG" | head -50 | cut -c1-4000)
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    -d text="$TELEGRAM_TEXT" \
    -d parse_mode="" > /dev/null 2>&1 || true
fi

# Log reward signals for successfully completed tasks (Gap 13)
PATTERNS_FILE="$WORKSPACE/memory/prompt-patterns.md"
DONE_TASKS=$(jq -r '.tasks[] | select(.status == "done" and .notified == true) | .id' "$TASKS_FILE" 2>/dev/null || echo "")

for TASK_ID in $DONE_TASKS; do
  [ -z "$TASK_ID" ] && continue
  # Check if already logged (avoid duplicates)
  if [ -f "$PATTERNS_FILE" ] && grep -q "$TASK_ID" "$PATTERNS_FILE" 2>/dev/null; then
    continue
  fi

  DESCRIPTION=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .description // empty" "$TASKS_FILE")
  AGENT=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .agent // empty" "$TASKS_FILE")
  MODEL=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .model // empty" "$TASKS_FILE")
  RETRY_COUNT=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .retryCount // 0" "$TASKS_FILE")
  STARTED=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .startedAt // 0" "$TASKS_FILE")
  COMPLETED=$(jq -r ".tasks[] | select(.id == \"$TASK_ID\") | .completedAt // 0" "$TASKS_FILE")

  if [ "$STARTED" -gt 0 ] && [ "$COMPLETED" -gt 0 ]; then
    DURATION_S=$(( (COMPLETED - STARTED) / 1000 ))
  else
    DURATION_S="unknown"
  fi

  TODAY=$(TZ="Australia/Melbourne" date '+%Y-%m-%d')
  {
    echo ""
    echo "### $TODAY"
    echo "- Task: \"$DESCRIPTION\" (id: $TASK_ID)"
    echo "  Agent: $AGENT | Model: $MODEL"
    echo "  Retries: $RETRY_COUNT | Duration: ${DURATION_S}s"
    echo "  Result: Success"
  } >> "$PATTERNS_FILE"
done

echo "Agent check complete."
