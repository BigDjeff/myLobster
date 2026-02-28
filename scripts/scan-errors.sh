#!/usr/bin/env bash
set -euo pipefail

# scan-errors.sh — Scan gateway error logs for new errors since last check.
# Reads the last scan timestamp from heartbeat-state.json, finds new errors,
# and sends a Telegram summary if any are found.

BASE_DIR="/Users/jeffcheng/.openclaw"
ERR_LOG="$BASE_DIR/logs/gateway.err.log"
STATE_FILE="$BASE_DIR/workspace/memory/heartbeat-state.json"
MEMORY_DIR="$BASE_DIR/workspace/memory"
BOT_TOKEN=$(jq -r '.channels.telegram.botToken' "$BASE_DIR/openclaw.json")
CHAT_ID="5014458510"

# Get last scan timestamp (ISO 8601)
LAST_SCAN=$(jq -r '.lastChecks.errorLog // empty' "$STATE_FILE" 2>/dev/null || echo "")

if [ ! -f "$ERR_LOG" ]; then
  echo "No error log found at $ERR_LOG. Nothing to scan."
  exit 0
fi

# Convert last scan to epoch seconds for comparison
if [ -n "$LAST_SCAN" ]; then
  LAST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_SCAN%%+*}" "+%s" 2>/dev/null || echo "0")
else
  # First run: scan last 4 hours
  LAST_EPOCH=$(( $(date +%s) - 14400 ))
fi

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%S+00:00")
NOW_EPOCH=$(date +%s)

# Extract lines newer than last scan.
# gateway.err.log lines typically start with a timestamp or are plain text.
# We'll grab all lines and filter by file modification approach:
# Since the log may not have per-line timestamps, we use byte offset tracking.

OFFSET_KEY="errorLogByteOffset"
LAST_OFFSET=$(jq -r ".${OFFSET_KEY} // 0" "$STATE_FILE" 2>/dev/null || echo "0")
CURRENT_SIZE=$(wc -c < "$ERR_LOG" | tr -d ' ')

if [ "$CURRENT_SIZE" -le "$LAST_OFFSET" ]; then
  # Log was rotated or no new content
  if [ "$CURRENT_SIZE" -lt "$LAST_OFFSET" ]; then
    # Log was rotated, scan from beginning
    LAST_OFFSET=0
  else
    echo "No new error log entries since last scan."
    # Update timestamp even if nothing new
    jq ".lastChecks.errorLog = \"$NOW_ISO\"" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
    exit 0
  fi
fi

# Extract new lines since last offset
NEW_ERRORS=$(tail -c +"$((LAST_OFFSET + 1))" "$ERR_LOG" 2>/dev/null || echo "")

if [ -z "$NEW_ERRORS" ]; then
  echo "No new error entries."
  jq ".lastChecks.errorLog = \"$NOW_ISO\"" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  exit 0
fi

# Count new error lines
NEW_LINE_COUNT=$(echo "$NEW_ERRORS" | wc -l | tr -d ' ')

# Deduplicate and summarize: find unique error patterns
UNIQUE_ERRORS=$(echo "$NEW_ERRORS" | sort | uniq -c | sort -rn | head -20)

# Build summary
SUMMARY="Error Log Scan Report ($(date '+%Y-%m-%d %H:%M'))

$NEW_LINE_COUNT new error line(s) since last scan.

Top recurring patterns:
$UNIQUE_ERRORS"

# Log to daily memory file
TODAY=$(TZ="Australia/Melbourne" date '+%Y-%m-%d')
DAILY_FILE="$MEMORY_DIR/${TODAY}.md"
{
  echo ""
  echo "### Error Log Scan - $(TZ='Australia/Melbourne' date '+%H:%M')"
  echo "$NEW_LINE_COUNT new error lines found."
  echo '```'
  echo "$UNIQUE_ERRORS" | head -10
  echo '```'
} >> "$DAILY_FILE"

# Send Telegram notification only if there are meaningful errors (not just empty lines)
MEANINGFUL_COUNT=$(echo "$NEW_ERRORS" | grep -cv '^[[:space:]]*$' || echo "0")

if [ "$MEANINGFUL_COUNT" -gt 0 ]; then
  # Truncate for Telegram (max 4096 chars)
  TELEGRAM_MSG=$(echo "$SUMMARY" | head -40 | cut -c1-4000)
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    -d text="$TELEGRAM_MSG" \
    -d parse_mode="" > /dev/null 2>&1 || true
fi

# Update state: save new byte offset and timestamp
jq ".lastChecks.errorLog = \"$NOW_ISO\" | .errorLogByteOffset = $CURRENT_SIZE" \
  "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"

echo "Scan complete. $MEANINGFUL_COUNT meaningful error lines found."
