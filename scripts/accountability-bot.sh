#!/usr/bin/env bash
set -euo pipefail

# accountability-bot.sh — Start/stop/status for the accountability bot.
#
# Usage:
#   scripts/accountability-bot.sh start   — start bot in background
#   scripts/accountability-bot.sh stop    — stop running bot
#   scripts/accountability-bot.sh status  — check if running
#
# The bot runs as a standalone process, isolated from other OpenClaw agents.
# It polls Telegram for user replies and sends scheduled check-ins.

readonly WORKSPACE="/Users/jeffcheng/.openclaw/workspace"
readonly BOT_DIR="${WORKSPACE}/accountability"
readonly PID_FILE="${BOT_DIR}/data/bot.pid"
readonly LOG_FILE="${BOT_DIR}/data/bot.log"

case "${1:-help}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Bot is already running (PID: $(cat "$PID_FILE"))"
      exit 0
    fi

    echo "Starting accountability bot..."
    cd "$WORKSPACE"
    nohup node accountability/bot.js start >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Bot started (PID: $!)"
    echo "Logs: $LOG_FILE"
    ;;

  stop)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping bot (PID: $PID)..."
        kill "$PID"
        rm -f "$PID_FILE"
        echo "Bot stopped."
      else
        echo "Bot is not running (stale PID file). Cleaning up."
        rm -f "$PID_FILE"
      fi
    else
      echo "Bot is not running (no PID file)."
    fi
    ;;

  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Accountability bot is running (PID: $(cat "$PID_FILE"))"
      echo "Log tail:"
      tail -5 "$LOG_FILE" 2>/dev/null || echo "  (no logs yet)"
    else
      echo "Accountability bot is not running."
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|status}"
    echo ""
    echo "  start   — Start the accountability bot in the background"
    echo "  stop    — Stop the running bot"
    echo "  status  — Check if the bot is running"
    ;;
esac
