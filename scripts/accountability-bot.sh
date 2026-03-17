#!/usr/bin/env bash
set -euo pipefail

# accountability-bot.sh — Daemon control for the accountability bot.
#
# Usage:
#   scripts/accountability-bot.sh start      — start bot in background
#   scripts/accountability-bot.sh stop       — graceful stop (SIGTERM)
#   scripts/accountability-bot.sh kill       — force kill (SIGKILL)
#   scripts/accountability-bot.sh restart    — stop + start
#   scripts/accountability-bot.sh status     — check if running
#   scripts/accountability-bot.sh activate   — set bot state to ACTIVE
#   scripts/accountability-bot.sh deactivate — set bot state to INACTIVE
#   scripts/accountability-bot.sh logs       — tail the log file
#
# The bot runs as a standalone background process, isolated from other OpenClaw agents.
# Use /acc commands in Telegram for runtime control.

readonly WORKSPACE="/Users/jeffcheng/.openclaw/workspace"
readonly BOT_DIR="${WORKSPACE}/accountability"
readonly PID_FILE="${BOT_DIR}/data/bot.pid"
readonly LOG_FILE="${BOT_DIR}/data/bot.log"

_is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

_get_pid() {
  cat "$PID_FILE" 2>/dev/null
}

case "${1:-help}" in
  start)
    if _is_running; then
      echo "Bot is already running (PID: $(_get_pid))"
      exit 0
    fi

    echo "Starting accountability bot..."
    cd "$WORKSPACE"
    nohup node accountability/bot.js start >> "$LOG_FILE" 2>&1 &
    local_pid=$!
    echo "$local_pid" > "$PID_FILE"

    # Wait briefly and verify it started
    sleep 1
    if kill -0 "$local_pid" 2>/dev/null; then
      echo "Bot started (PID: $local_pid)"
      echo "Logs: $LOG_FILE"
      echo ""
      echo "Telegram commands:"
      echo "  /acc start  — activate check-ins"
      echo "  /acc stop   — deactivate check-ins"
      echo "  /acc kill   — shut down bot"
      echo "  /acc status — check state"
    else
      echo "ERROR: Bot failed to start. Check logs: $LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;

  stop)
    if _is_running; then
      PID=$(_get_pid)
      echo "Stopping bot (PID: $PID)..."
      kill "$PID"

      # Wait for graceful shutdown (up to 5 seconds)
      for _ in $(seq 1 5); do
        if ! kill -0 "$PID" 2>/dev/null; then
          break
        fi
        sleep 1
      done

      rm -f "$PID_FILE"
      echo "Bot stopped."
    else
      echo "Bot is not running."
      rm -f "$PID_FILE"
    fi
    ;;

  kill)
    if _is_running; then
      PID=$(_get_pid)
      echo "Force killing bot (PID: $PID)..."
      kill -9 "$PID" 2>/dev/null || true
      rm -f "$PID_FILE"
      echo "Bot killed."
    else
      echo "Bot is not running."
      rm -f "$PID_FILE"
    fi
    ;;

  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;

  status)
    if _is_running; then
      PID=$(_get_pid)
      # Check active state from DB
      cd "$WORKSPACE"
      ACTIVE=$(node -e "
        const db = require('./accountability/habit-db');
        db.getDb();
        console.log(db.getConfig('bot_active') === 'true' ? 'ACTIVE' : 'INACTIVE');
        db.closeDb();
      " 2>/dev/null || echo "UNKNOWN")
      echo "Accountability bot is running (PID: $PID, state: $ACTIVE)"
      echo ""
      echo "Log tail:"
      tail -5 "$LOG_FILE" 2>/dev/null || echo "  (no logs yet)"
    else
      echo "Accountability bot is not running."
    fi
    ;;

  activate)
    cd "$WORKSPACE"
    node accountability/bot.js activate
    ;;

  deactivate)
    cd "$WORKSPACE"
    node accountability/bot.js deactivate
    ;;

  logs)
    tail -20 "$LOG_FILE" 2>/dev/null || echo "(no logs yet)"
    ;;

  *)
    echo "Usage: $0 {start|stop|kill|restart|status|activate|deactivate|logs}"
    echo ""
    echo "  start      — Start the bot in the background"
    echo "  stop       — Graceful stop (SIGTERM)"
    echo "  kill       — Force kill (SIGKILL)"
    echo "  restart    — Stop + start"
    echo "  status     — Check if running and active state"
    echo "  activate   — Set bot to ACTIVE mode"
    echo "  deactivate — Set bot to INACTIVE mode"
    echo "  logs       — Tail the log file"
    echo ""
    echo "Telegram commands (while running):"
    echo "  /acc start  — activate check-ins & replies"
    echo "  /acc stop   — deactivate (process stays alive)"
    echo "  /acc kill   — shut down bot process"
    echo "  /acc status — show bot state"
    echo "  /acc help   — show all commands"
    ;;
esac
