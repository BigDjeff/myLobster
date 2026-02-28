#!/usr/bin/env bash
set -euo pipefail

# daily-cost-summary.sh — Query llm_calls.db and report daily token spend to Telegram.
# Runs at 9pm Melbourne time daily.

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
DB_PATH="$WORKSPACE/data/llm_calls.db"
BOT_TOKEN=$(jq -r '.channels.telegram.botToken' "$BASE_DIR/openclaw.json")
CHAT_ID="5014458510"

if [ ! -f "$DB_PATH" ]; then
  echo "No LLM calls database found at $DB_PATH."
  exit 0
fi

TODAY=$(TZ="Australia/Melbourne" date '+%Y-%m-%d')

# Query the database for today's stats
STATS=$(sqlite3 "$DB_PATH" <<SQL
SELECT
  COUNT(*) as total_calls,
  COALESCE(SUM(input_tokens), 0) as total_input_tokens,
  COALESCE(SUM(output_tokens), 0) as total_output_tokens,
  ROUND(COALESCE(SUM(cost_estimate), 0), 4) as total_cost,
  COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) as successful,
  COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) as failed
FROM llm_calls
WHERE date(timestamp) = '$TODAY';
SQL
)

# Parse pipe-separated output
TOTAL_CALLS=$(echo "$STATS" | cut -d'|' -f1)
INPUT_TOKENS=$(echo "$STATS" | cut -d'|' -f2)
OUTPUT_TOKENS=$(echo "$STATS" | cut -d'|' -f3)
TOTAL_COST=$(echo "$STATS" | cut -d'|' -f4)
SUCCESSFUL=$(echo "$STATS" | cut -d'|' -f5)
FAILED=$(echo "$STATS" | cut -d'|' -f6)

# Per-model breakdown
MODEL_BREAKDOWN=$(sqlite3 "$DB_PATH" <<SQL
SELECT
  model,
  COUNT(*) as calls,
  ROUND(COALESCE(SUM(cost_estimate), 0), 4) as cost
FROM llm_calls
WHERE date(timestamp) = '$TODAY'
GROUP BY model
ORDER BY cost DESC;
SQL
)

# Per-caller breakdown
CALLER_BREAKDOWN=$(sqlite3 "$DB_PATH" <<SQL
SELECT
  caller,
  COUNT(*) as calls,
  ROUND(COALESCE(SUM(cost_estimate), 0), 4) as cost
FROM llm_calls
WHERE date(timestamp) = '$TODAY'
GROUP BY caller
ORDER BY cost DESC
LIMIT 10;
SQL
)

# Build message
MSG="Daily Cost Report ($TODAY)

Total: \$${TOTAL_COST} | ${TOTAL_CALLS} calls
Input: ${INPUT_TOKENS} tokens | Output: ${OUTPUT_TOKENS} tokens
Success: ${SUCCESSFUL} | Failed: ${FAILED}

By Model:"

while IFS='|' read -r model calls cost; do
  [ -z "$model" ] && continue
  MSG="${MSG}
  ${model}: \$${cost} (${calls} calls)"
done <<< "$MODEL_BREAKDOWN"

if [ -n "$CALLER_BREAKDOWN" ]; then
  MSG="${MSG}

By Caller:"
  while IFS='|' read -r caller calls cost; do
    [ -z "$caller" ] && continue
    MSG="${MSG}
  ${caller}: \$${cost} (${calls} calls)"
  done <<< "$CALLER_BREAKDOWN"
fi

# Send to Telegram
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="$CHAT_ID" \
  -d text="$MSG" \
  -d parse_mode="" > /dev/null 2>&1 || true

# Also log to daily memory file
MEMORY_DIR="$WORKSPACE/memory"
DAILY_FILE="$MEMORY_DIR/${TODAY}.md"
{
  echo ""
  echo "### Daily Cost Summary"
  echo "- Total: \$${TOTAL_COST} across ${TOTAL_CALLS} LLM calls"
  echo "- Input tokens: ${INPUT_TOKENS} | Output tokens: ${OUTPUT_TOKENS}"
  echo "- Success rate: ${SUCCESSFUL}/${TOTAL_CALLS}"
} >> "$DAILY_FILE"

echo "Cost summary sent. Total spend: \$${TOTAL_COST}"
