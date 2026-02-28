#!/usr/bin/env bash
set -euo pipefail

# verify-cron.sh — Gap 4: Cron runner execution verification.
#
# Checks whether cron jobs actually ran on schedule by comparing
# last execution timestamps against expected intervals.
# Sends Telegram alert if any job missed its window.
#
# Runs every 30 minutes via cron.

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
CRON_JOBS="$BASE_DIR/cron/jobs.json"
STATE_FILE="$WORKSPACE/data/cron-verify-state.json"
LOG_DIR="$BASE_DIR/logs"
BOT_TOKEN=$(jq -r '.channels.telegram.botToken' "$BASE_DIR/openclaw.json")
CHAT_ID="5014458510"

# Initialize state file if missing
if [ ! -f "$STATE_FILE" ]; then
  echo '{}' > "$STATE_FILE"
fi

# Read state
STATE=$(cat "$STATE_FILE")

# Read enabled jobs
JOBS=$(jq -c '.jobs[] | select(.enabled == true)' "$CRON_JOBS" 2>/dev/null || echo "")

ALERTS=""
UPDATED_STATE="$STATE"

now_epoch=$(date +%s)

for JOB_JSON in $JOBS; do
  JOB_ID=$(echo "$JOB_JSON" | jq -r '.id')
  SCHEDULE=$(echo "$JOB_JSON" | jq -r '.schedule')
  COMMAND=$(echo "$JOB_JSON" | jq -r '.command')

  # Get last known execution time from state
  LAST_RUN=$(echo "$UPDATED_STATE" | jq -r ".\"${JOB_ID}\".lastRun // 0")
  LAST_VERIFIED=$(echo "$UPDATED_STATE" | jq -r ".\"${JOB_ID}\".lastVerified // 0")

  # Calculate expected interval from cron schedule
  # Parse common cron patterns to determine max expected gap (in seconds)
  MAX_GAP=0
  case "$SCHEDULE" in
    "*/5 "*) MAX_GAP=$((5 * 60 * 2));;       # Every 5 min → allow 10 min gap
    "*/10 "*) MAX_GAP=$((10 * 60 * 2));;     # Every 10 min → allow 20 min gap
    "*/15 "*) MAX_GAP=$((15 * 60 * 2));;     # Every 15 min → allow 30 min gap
    "*/30 "*) MAX_GAP=$((30 * 60 * 2));;     # Every 30 min → allow 60 min gap
    "0 */1 "*) MAX_GAP=$((60 * 60 * 2));;    # Every hour → allow 2 hour gap
    "0 */2 "*) MAX_GAP=$((2 * 60 * 60 * 2));; # Every 2 hours → allow 4 hour gap
    "0 */4 "*) MAX_GAP=$((4 * 60 * 60 * 2));; # Every 4 hours → allow 8 hour gap
    *" * * *") MAX_GAP=$((24 * 60 * 60 + 3600));; # Daily → allow 25 hours
    *) MAX_GAP=$((24 * 60 * 60 + 3600));;    # Default: 25 hours
  esac

  # Check if the job's command script exists
  SCRIPT_PATH=""
  if echo "$COMMAND" | grep -q "bash "; then
    SCRIPT_PATH=$(echo "$COMMAND" | grep -oP '(?<=bash )\S+')
  fi

  # Look for evidence of execution:
  # 1. Check if there's a log file or recent output
  # 2. Check file modification times of known output files

  JOB_EVIDENCE=false
  EVIDENCE_TIME=0

  # Check for direct log files
  JOB_LOG="$LOG_DIR/cron-${JOB_ID}.log"
  if [ -f "$JOB_LOG" ]; then
    LOG_MTIME=$(stat -f %m "$JOB_LOG" 2>/dev/null || stat -c %Y "$JOB_LOG" 2>/dev/null || echo "0")
    if [ "$LOG_MTIME" -gt "$LAST_RUN" ]; then
      JOB_EVIDENCE=true
      EVIDENCE_TIME=$LOG_MTIME
    fi
  fi

  # Check evidence based on job type
  case "$JOB_ID" in
    check-agents)
      # check-agents updates active-tasks.json
      TASKS_FILE="$WORKSPACE/data/active-tasks.json"
      if [ -f "$TASKS_FILE" ]; then
        MTIME=$(stat -f %m "$TASKS_FILE" 2>/dev/null || stat -c %Y "$TASKS_FILE" 2>/dev/null || echo "0")
        if [ "$MTIME" -gt "$LAST_RUN" ] && [ "$MTIME" -gt "$EVIDENCE_TIME" ]; then
          JOB_EVIDENCE=true
          EVIDENCE_TIME=$MTIME
        fi
      fi
      ;;
    scan-error-logs)
      # scan-errors updates heartbeat-state.json
      HB_FILE="$WORKSPACE/memory/heartbeat-state.json"
      if [ -f "$HB_FILE" ]; then
        MTIME=$(stat -f %m "$HB_FILE" 2>/dev/null || stat -c %Y "$HB_FILE" 2>/dev/null || echo "0")
        if [ "$MTIME" -gt "$LAST_RUN" ] && [ "$MTIME" -gt "$EVIDENCE_TIME" ]; then
          JOB_EVIDENCE=true
          EVIDENCE_TIME=$MTIME
        fi
      fi
      ;;
    daily-git-digest|daily-cost-summary)
      # These append to daily memory files
      TODAY=$(TZ="Australia/Melbourne" date '+%Y-%m-%d')
      MEMORY_FILE="$WORKSPACE/memory/${TODAY}.md"
      if [ -f "$MEMORY_FILE" ]; then
        MTIME=$(stat -f %m "$MEMORY_FILE" 2>/dev/null || stat -c %Y "$MEMORY_FILE" 2>/dev/null || echo "0")
        if [ "$MTIME" -gt "$LAST_RUN" ] && [ "$MTIME" -gt "$EVIDENCE_TIME" ]; then
          JOB_EVIDENCE=true
          EVIDENCE_TIME=$MTIME
        fi
      fi
      ;;
    cleanup-worktrees)
      # Runs at 3am, check if pruned today
      # Just trust the MAX_GAP check
      ;;
  esac

  # Update state with evidence
  if [ "$JOB_EVIDENCE" = true ]; then
    UPDATED_STATE=$(echo "$UPDATED_STATE" | jq ".\"${JOB_ID}\".lastRun = $EVIDENCE_TIME | .\"${JOB_ID}\".lastVerified = $now_epoch | .\"${JOB_ID}\".missedCount = 0")
  fi

  # Check if overdue
  EFFECTIVE_LAST_RUN=$LAST_RUN
  if [ "$EVIDENCE_TIME" -gt "$LAST_RUN" ]; then
    EFFECTIVE_LAST_RUN=$EVIDENCE_TIME
  fi

  if [ "$EFFECTIVE_LAST_RUN" -gt 0 ] && [ "$MAX_GAP" -gt 0 ]; then
    ELAPSED=$(( now_epoch - EFFECTIVE_LAST_RUN ))
    if [ "$ELAPSED" -gt "$MAX_GAP" ]; then
      HOURS_AGO=$(( ELAPSED / 3600 ))
      MISSED_COUNT=$(echo "$UPDATED_STATE" | jq -r ".\"${JOB_ID}\".missedCount // 0")
      NEW_MISSED=$(( MISSED_COUNT + 1 ))
      UPDATED_STATE=$(echo "$UPDATED_STATE" | jq ".\"${JOB_ID}\".missedCount = $NEW_MISSED | .\"${JOB_ID}\".lastVerified = $now_epoch")

      # Only alert after 2+ consecutive misses to avoid false positives
      if [ "$NEW_MISSED" -ge 2 ]; then
        ALERTS="${ALERTS}⏰ ${JOB_ID}: last ran ~${HOURS_AGO}h ago (schedule: ${SCHEDULE}, missed ${NEW_MISSED}x)\n"
      fi
    fi
  elif [ "$EFFECTIVE_LAST_RUN" -eq 0 ]; then
    # First run — initialize with current time so we don't alert on fresh installs
    UPDATED_STATE=$(echo "$UPDATED_STATE" | jq ".\"${JOB_ID}\".lastRun = $now_epoch | .\"${JOB_ID}\".lastVerified = $now_epoch | .\"${JOB_ID}\".missedCount = 0")
  fi
done

# Save updated state
echo "$UPDATED_STATE" | jq '.' > "$STATE_FILE"

# Send alert if any jobs are overdue
if [ -n "$ALERTS" ]; then
  MSG="Cron Verification Alert:\n${ALERTS}\nCheck crontab and job scripts."
  TELEGRAM_TEXT=$(echo -e "$MSG" | head -20 | cut -c1-4000)
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    -d text="$TELEGRAM_TEXT" \
    -d parse_mode="" > /dev/null 2>&1 || true
fi

echo "Cron verification complete. $(echo -e "$ALERTS" | grep -c '⏰' || echo 0) alerts."
