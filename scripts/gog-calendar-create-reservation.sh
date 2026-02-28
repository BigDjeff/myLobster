#!/usr/bin/env bash
set -euo pipefail

# Write helper: create a reservation event in Google Calendar via gog.
#
# Usage:
#   scripts/gog-calendar-create-reservation.sh \
#     --title "Paradise Valley Hotel (Bistro)" \
#     --date "2026-02-28" \
#     --start "13:30" \
#     --end "16:00" \
#     --location "Paradise Valley Hotel" \
#     --reservation "A47CF3T7LLS" \
#     --name "Jeff Cheng" \
#     --party "2" \
#     --area "Bistro"

CAL_ID="primary"
TITLE=""
DATE=""
START_TIME=""
END_TIME=""
LOCATION=""
RESERVATION=""
NAME=""
PARTY=""
AREA=""
EXTRA_DESCRIPTION=""
TIMEZONE="Australia/Melbourne"
SOURCE_URL="https://sevenrooms.com"
SOURCE_TITLE="SevenRooms Reservation"

while [ $# -gt 0 ]; do
  case "$1" in
    --calendar) CAL_ID="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --date) DATE="$2"; shift 2 ;;
    --start) START_TIME="$2"; shift 2 ;;
    --end) END_TIME="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --reservation) RESERVATION="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --party) PARTY="$2"; shift 2 ;;
    --area) AREA="$2"; shift 2 ;;
    --description) EXTRA_DESCRIPTION="$2"; shift 2 ;;
    --timezone) TIMEZONE="$2"; shift 2 ;;
    --source-url) SOURCE_URL="$2"; shift 2 ;;
    --source-title) SOURCE_TITLE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

for required in TITLE DATE START_TIME END_TIME; do
  if [ -z "${!required}" ]; then
    echo "Missing required option for $required" >&2
    exit 1
  fi
done

if ! command -v gog >/dev/null 2>&1; then
  echo "Error: gog is not installed or not in PATH." >&2
  exit 1
fi

START_RFC3339=$(python3 - <<PY
from datetime import datetime
from zoneinfo import ZoneInfo
print(datetime.strptime("${DATE} ${START_TIME}", "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("${TIMEZONE}")).isoformat())
PY
)

END_RFC3339=$(python3 - <<PY
from datetime import datetime
from zoneinfo import ZoneInfo
print(datetime.strptime("${DATE} ${END_TIME}", "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("${TIMEZONE}")).isoformat())
PY
)

DESCRIPTION=""
[ -n "$RESERVATION" ] && DESCRIPTION+="Reservation #${RESERVATION}\\n"
[ -n "$NAME" ] && DESCRIPTION+="Name: ${NAME}\\n"
[ -n "$PARTY" ] && DESCRIPTION+="Party size: ${PARTY}\\n"
[ -n "$AREA" ] && DESCRIPTION+="Reserved for: ${AREA}\\n"
[ -n "$EXTRA_DESCRIPTION" ] && DESCRIPTION+="${EXTRA_DESCRIPTION}"

# Trim trailing newlines
DESCRIPTION=$(printf "%b" "$DESCRIPTION" | sed '${/^$/d;}')

CMD=(
  gog calendar create "$CAL_ID"
  --summary="$TITLE"
  --from="$START_RFC3339"
  --to="$END_RFC3339"
  --source-title="$SOURCE_TITLE"
  --source-url="$SOURCE_URL"
  -j
)

[ -n "$LOCATION" ] && CMD+=("--location=$LOCATION")
[ -n "$DESCRIPTION" ] && CMD+=("--description=$DESCRIPTION")

"${CMD[@]}"
