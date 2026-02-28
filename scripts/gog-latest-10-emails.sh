#!/usr/bin/env bash
set -euo pipefail

# Read-only helper: show latest inbox threads via gog.
# Usage:
#   scripts/gog-latest-10-emails.sh
#   scripts/gog-latest-10-emails.sh 20
#   scripts/gog-latest-10-emails.sh 10 "in:inbox category:primary"

MAX="${1:-10}"
QUERY="${2:-in:inbox}"
TZ_NAME="Australia/Melbourne"

if ! command -v gog >/dev/null 2>&1; then
  echo "Error: gog is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required for formatted output." >&2
  exit 1
fi

gog gmail search "$QUERY" --max "$MAX" --timezone "$TZ_NAME" -j \
  | jq -r '
      .threads // []
      | to_entries[]
      | "\(.key + 1). [\(.value.date)] \(.value.from) | \(.value.subject)"
    '
