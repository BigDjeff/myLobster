#!/usr/bin/env bash
set -euo pipefail

# Read-only helper: show this week's and next week's calendar activity.
# Usage:
#   scripts/gog-calendar-weekly-summary.sh
#   scripts/gog-calendar-weekly-summary.sh <calendarId>

CAL_ID="${1:-primary}"
TZ_NAME="Australia/Melbourne"

if ! command -v gog >/dev/null 2>&1; then
  echo "Error: gog is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required for formatted output." >&2
  exit 1
fi

RANGE=$(python3 - <<'PY'
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
now = datetime.now(ZoneInfo('Australia/Melbourne')).date()
next_monday = now + timedelta(days=(7 - now.weekday()))
next_sunday = next_monday + timedelta(days=6)
print(next_monday.isoformat(), next_sunday.isoformat())
PY
)

NEXT_FROM=$(echo "$RANGE" | awk '{print $1}')
NEXT_TO=$(echo "$RANGE" | awk '{print $2}')

echo "This week (${TZ_NAME})"
gog calendar events "$CAL_ID" --week --max=250 -j \
  | jq -r '
      .events // []
      | if length == 0 then "(no events)" else .[] | "- \(.start.dateTime // .start.date // "?") -> \(.end.dateTime // .end.date // "?") | \(.summary // "(no title)")" end
    '

echo ""
echo "Next week (${NEXT_FROM} to ${NEXT_TO}, ${TZ_NAME})"
gog calendar events "$CAL_ID" --from="$NEXT_FROM" --to="$NEXT_TO" --max=250 -j \
  | jq -r '
      .events // []
      | if length == 0 then "(no events)" else .[] | "- \(.start.dateTime // .start.date // "?") -> \(.end.dateTime // .end.date // "?") | \(.summary // "(no title)")" end
    '
