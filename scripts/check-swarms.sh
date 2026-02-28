#!/usr/bin/env bash
set -euo pipefail

# check-swarms.sh — Monitor swarm_tasks.db for stale tasks and completed swarms.
#
# 1. Reset stale tasks (claimed/running > 15 min ago) back to pending
# 2. Detect fully completed swarms
# 3. Send Telegram notification for completed swarms
# 4. No LLM tokens consumed (pure bash + sqlite3 CLI)
#
# Runs every 5 minutes via cron.

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
SWARM_DB="$WORKSPACE/data/swarm_tasks.db"
NODE="$(which node)"
BOT_TOKEN=$(jq -r '.channels.telegram.botToken' "$BASE_DIR/openclaw.json")
CHAT_ID="5014458510"

# Exit early if no swarm DB
if [ ! -f "$SWARM_DB" ]; then
  exit 0
fi

# 1. Reset stale tasks (claimed/running for > 15 minutes)
STALE_COUNT=$(sqlite3 "$SWARM_DB" "
  UPDATE swarm_tasks
  SET status = 'pending', agent_id = NULL, claimed_at = NULL
  WHERE status IN ('claimed', 'running')
  AND claimed_at < datetime('now', '-15 minutes');
  SELECT changes();
" 2>/dev/null || echo "0")

if [ "$STALE_COUNT" -gt 0 ]; then
  echo "Reset $STALE_COUNT stale swarm tasks to pending."
fi

# 2. Find completed swarms (all tasks done or failed, at least one task exists)
COMPLETED_SWARMS=$(sqlite3 "$SWARM_DB" "
  SELECT DISTINCT s1.swarm_id
  FROM swarm_tasks s1
  WHERE NOT EXISTS (
    SELECT 1 FROM swarm_tasks s2
    WHERE s2.swarm_id = s1.swarm_id
    AND s2.status NOT IN ('done', 'failed')
  )
  AND NOT EXISTS (
    SELECT 1 FROM swarm_tasks s3
    WHERE s3.swarm_id = s1.swarm_id
    AND s3.metadata LIKE '%\"notified\":true%'
  )
  GROUP BY s1.swarm_id
  HAVING COUNT(*) > 0;
" 2>/dev/null || echo "")

NOTIFY_MSG=""

for SWARM_ID in $COMPLETED_SWARMS; do
  [ -z "$SWARM_ID" ] && continue

  # Get swarm stats
  TOTAL=$(sqlite3 "$SWARM_DB" "SELECT COUNT(*) FROM swarm_tasks WHERE swarm_id='$SWARM_ID'" 2>/dev/null || echo "0")
  DONE=$(sqlite3 "$SWARM_DB" "SELECT COUNT(*) FROM swarm_tasks WHERE swarm_id='$SWARM_ID' AND status='done'" 2>/dev/null || echo "0")
  FAILED=$(sqlite3 "$SWARM_DB" "SELECT COUNT(*) FROM swarm_tasks WHERE swarm_id='$SWARM_ID' AND status='failed'" 2>/dev/null || echo "0")

  if [ "$FAILED" -gt 0 ]; then
    NOTIFY_MSG="${NOTIFY_MSG}⚠ Swarm ${SWARM_ID}: ${DONE}/${TOTAL} done, ${FAILED} failed\n"
  else
    NOTIFY_MSG="${NOTIFY_MSG}✓ Swarm ${SWARM_ID}: ${DONE}/${TOTAL} tasks completed\n"
  fi

  # Get task descriptions for detail
  TASK_LIST=$(sqlite3 "$SWARM_DB" "
    SELECT '  ' || CASE status WHEN 'done' THEN '✓' ELSE '✗' END || ' ' || description
    FROM swarm_tasks WHERE swarm_id='$SWARM_ID' ORDER BY seq LIMIT 10
  " 2>/dev/null || echo "")

  if [ -n "$TASK_LIST" ]; then
    NOTIFY_MSG="${NOTIFY_MSG}${TASK_LIST}\n"
  fi

  # Mark swarm tasks as notified (update metadata)
  sqlite3 "$SWARM_DB" "
    UPDATE swarm_tasks
    SET metadata = COALESCE(
      json_set(COALESCE(metadata, '{}'), '$.notified', json('true')),
      '{\"notified\":true}'
    )
    WHERE swarm_id = '$SWARM_ID';
  " 2>/dev/null || true
done

# 3. Send notification if there are completed swarms
if [ -n "$NOTIFY_MSG" ]; then
  MSG="Swarm Report:\n${NOTIFY_MSG}"
  TELEGRAM_TEXT=$(echo -e "$MSG" | head -30 | cut -c1-4000)
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    -d text="$TELEGRAM_TEXT" \
    -d parse_mode="" > /dev/null 2>&1 || true
fi

# 4. Summary
ACTIVE_SWARMS=$(sqlite3 "$SWARM_DB" "
  SELECT COUNT(DISTINCT swarm_id) FROM swarm_tasks WHERE status IN ('pending', 'claimed', 'running')
" 2>/dev/null || echo "0")

echo "Swarm check complete. Active swarms: $ACTIVE_SWARMS. Stale resets: $STALE_COUNT."
