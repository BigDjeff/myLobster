# Accountability Bot Fix — 2026-03-17

## Problem
The accountability bot, when started via `node accountability/bot.js start`, would intercept ALL Telegram messages — overwriting the normal OpenClaw Telegram session. Every message sent to the bot was consumed by the accountability module's polling loop, with no way to exit or stop from Telegram.

## Root Cause
1. The bot's `getUpdates` long-polling consumed ALL incoming Telegram messages
2. No `/acc` command routing — every message was matched against accountability keywords
3. Unrecognized messages were silently consumed (logged but not forwarded)
4. No Telegram-based way to stop, pause, or exit the bot
5. No active/inactive state — the bot was always processing

## What Changed

### bot.js — Major Rewrite
- **Active/Inactive state**: Bot now has a `bot_active` flag stored in the database
  - ACTIVE: processes accountability keywords + sends scheduled check-ins
  - INACTIVE: only listens for `/acc` commands, ignores everything else
- **Telegram `/acc` commands**: Always processed regardless of active state
  - `/acc start` — activate check-ins & reply processing
  - `/acc stop` — deactivate (process stays alive, stops processing)
  - `/acc kill` — shut down the bot process entirely
  - `/acc status` — show bot state, PID, uptime, weekly stats
  - `/acc help` — show all commands
- **Scheduler gated by active state**: Scheduled check-ins only fire when ACTIVE
- **Force quit**: `/acc kill` sends shutdown message then terminates the process
- **CLI additions**: `activate` and `deactivate` subcommands for DB-only state changes

### accountability-bot.sh — Enhanced Daemon Control
- **New commands**: `kill` (SIGKILL), `restart` (stop + start), `activate`, `deactivate`, `logs`
- **Startup verification**: Waits 1 second after launch and verifies PID is alive
- **Graceful shutdown**: Waits up to 5 seconds for SIGTERM before cleanup
- **Status shows active state**: Reads `bot_active` from DB and displays it

## How to Use

### Start the bot (background daemon):
```bash
scripts/accountability-bot.sh start
```

### Control from Telegram:
- `/acc start` — turn ON check-ins and replies
- `/acc stop` — turn OFF (bot process stays alive for future `/acc start`)
- `/acc kill` — completely shut down the bot process
- `/acc status` — see if active/inactive, PID, uptime
- `/acc help` — see all commands

### Control from terminal:
```bash
scripts/accountability-bot.sh stop       # graceful
scripts/accountability-bot.sh kill       # force
scripts/accountability-bot.sh restart    # stop + start
scripts/accountability-bot.sh status     # running? active?
scripts/accountability-bot.sh activate   # set ACTIVE in DB
scripts/accountability-bot.sh deactivate # set INACTIVE in DB
scripts/accountability-bot.sh logs       # tail log file
```

### Key behavior:
- Bot starts in whatever state was last set (default: INACTIVE)
- When INACTIVE: only responds to `/acc` commands, ignores all other messages
- When ACTIVE: processes accountability keywords AND `/acc` commands
- No interference with other OpenClaw commands when INACTIVE
- Bot is currently OFF (process not running, state set to INACTIVE)

## Validation
- `node --check accountability/bot.js` — syntax OK
- `npm test` — 128 passed, 0 failed
- `node accountability/test-accountability.js` — 125 passed, 0 failed
- Bot process confirmed not running
- `bot_active` set to `false` in database
