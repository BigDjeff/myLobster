#!/usr/bin/env bash
set -euo pipefail

GUARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD_JS="$GUARD_DIR/shared/gateway-guard.js"
PID_FILE="$HOME/.openclaw/gateway-guard.pid"
LOG_FILE="$HOME/.openclaw/logs/gateway-guard.log"

# Kill existing guard if running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[gateway-guard] stopping previous instance (PID $OLD_PID)"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

echo "[gateway-guard] starting..."
node "$GUARD_JS" >> "$LOG_FILE" 2>&1 &
GUARD_PID=$!
echo "$GUARD_PID" > "$PID_FILE"
echo "[gateway-guard] started (PID $GUARD_PID), logging to $LOG_FILE"
