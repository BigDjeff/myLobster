#!/usr/bin/env bash
set -euo pipefail

# scan-git-changelog.sh — Daily git log digest.
# Scans the workspace git log for the last 24 hours and appends a summary
# to the daily memory file.

BASE_DIR="/Users/jeffcheng/.openclaw"
WORKSPACE="$BASE_DIR/workspace"
MEMORY_DIR="$WORKSPACE/memory"
BOT_TOKEN=$(jq -r '.channels.telegram.botToken' "$BASE_DIR/openclaw.json")
CHAT_ID="5014458510"

TODAY=$(TZ="Australia/Melbourne" date '+%Y-%m-%d')
DAILY_FILE="$MEMORY_DIR/${TODAY}.md"

cd "$WORKSPACE"

# Check if this is a git repo
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "Not a git repository. Skipping."
  exit 0
fi

# Get git log for last 24 hours
LOG_OUTPUT=$(git log --since="24 hours ago" --pretty=format:"%h %s (%an, %ar)" --no-merges 2>/dev/null || echo "")

if [ -z "$LOG_OUTPUT" ]; then
  echo "No commits in the last 24 hours."
  exit 0
fi

COMMIT_COUNT=$(echo "$LOG_OUTPUT" | wc -l | tr -d ' ')

# Get file change stats
STAT_OUTPUT=$(git log --since="24 hours ago" --stat --no-merges --pretty=format:"" 2>/dev/null | grep -v '^$' | tail -5 || echo "")

# Most changed files in the last 24 hours
CHANGED_FILES=$(git log --since="24 hours ago" --name-only --no-merges --pretty=format:"" 2>/dev/null | sort | uniq -c | sort -rn | head -10 || echo "")

# Build digest
DIGEST="## Git Digest - $TODAY

**$COMMIT_COUNT commit(s)** in the last 24 hours.

### Commits
$LOG_OUTPUT

### Most Changed Files
\`\`\`
$CHANGED_FILES
\`\`\`"

# Append to daily memory file
{
  echo ""
  echo "$DIGEST"
} >> "$DAILY_FILE"

# Send brief Telegram summary
TELEGRAM_MSG="Daily Git Digest ($TODAY)

$COMMIT_COUNT commit(s) in the last 24 hours.

$(echo "$LOG_OUTPUT" | head -15)"

curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="$CHAT_ID" \
  -d text="$TELEGRAM_MSG" \
  -d parse_mode="" > /dev/null 2>&1 || true

echo "Git digest complete. $COMMIT_COUNT commits logged."
