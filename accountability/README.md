# Accountability Module

Personal accountability system for Jeff's boxing, gym, and wellbeing routine. Runs as a **contained, isolated module** within OpenClaw — does NOT interact with any other OpenClaw agents, databases, or shared modules.

## Architecture

```
accountability/
├── config.js              # Boxing schedule, phase targets, check-in timing
├── habit-db.js            # SQLite database layer (data/habits.db)
├── telegram.js            # Telegram Bot API (send + receive messages)
├── scheduler.js           # Time-based check-in logic + reply processing
├── pattern-detector.js    # Anti-relapse pattern detection
├── reports.js             # Weekly + trainer report generation
├── bot.js                 # Main bot process (start/stop/status)
├── cli.js                 # Manual CLI for testing and logging
├── test-accountability.js # Standalone test suite
├── README.md              # This file
└── data/
    ├── habits.db          # SQLite database (created on first run)
    ├── bot.pid            # PID file for running bot
    └── bot.log            # Bot process log
```

## Isolation Guarantees

- **Database**: Uses `accountability/data/habits.db` — never touches `workspace/data/*.db`
- **No shared module imports**: Does NOT require llm-router, openai-chat, interaction-store, or any `shared/` module
- **Telegram**: Reads bot token from `~/.openclaw/openclaw.json` (same source as existing scripts) but sends to a private chat only
- **No side effects**: Can be started/stopped independently without affecting other agents

## Quick Start

```bash
# 1. Run tests to verify everything works
node accountability/test-accountability.js

# 2. Send a test Telegram message
node accountability/cli.js send-test

# 3. Check status
node accountability/cli.js status

# 4. Plan this week's sessions
node accountability/cli.js plan-week

# 5. Start the bot (runs in background)
scripts/accountability-bot.sh start

# 6. Check bot status
scripts/accountability-bot.sh status

# 7. Stop the bot
scripts/accountability-bot.sh stop
```

## How It Works

### Phases (Gradual Ramp-Up)

| Phase | Name | Boxing | Gym | Total | Duration |
|-------|------|--------|-----|-------|----------|
| 1 | Foundation | 1/week | 1/week | 2 | 4 weeks |
| 2 | Building | 2/week | 1/week | 3 | 4 weeks |
| 3 | Sustainable | 2/week | 2/week | 4 | Ongoing |

Start at Phase 1. The system auto-suggests advancing when you hit 3 of 4 weeks at target.

### Daily Check-in Flow

```
9:30 PM  → Bedtime nudge ("wind down, bag ready")
10:30 PM → Escalation if no reply ("you're still up")
7:00 AM  → Morning plan ("Boxing Basics at 6pm, reply CONFIRM")
4:30 PM  → Pre-session reminder ("90 min to go, reply HEADING OUT")
5:30 PM  → Follow-up if no reply ("what happened?")
Sunday   → Weekly report (sessions, streaks, trends)
```

### Reply Keywords

| Reply | Action |
|-------|--------|
| CONFIRM / YES | Lock in today's session |
| HEADING OUT / GOING / OMW | Acknowledge departure |
| DONE / TRAINED | Log completed session |
| SKIP / NAH | Mark session as skipped |
| RESCHEDULE / TOMORROW | Move to another day |
| LIGHTS OUT / SLEEP | Log bedtime |
| STATUS | View current progress |
| HELP | Show all commands |

### Pattern Detection

The system monitors for:
- **Consecutive skips**: 2+ planned sessions skipped in a row → suggests lighter session
- **Late bedtimes**: 3+ nights past 10:30 PM in a week → emphasizes sleep
- **Declining trend**: 3 weeks of fewer sessions each week → intervention

### CLI Commands

```bash
# Log a session manually
node accountability/cli.js log-session boxing "Boxing Basics" 60
node accountability/cli.js log-session gym "Trainer" 45 "Legs day"

# Log bedtime
node accountability/cli.js log-sleep on-time
node accountability/cli.js log-sleep late

# View status
node accountability/cli.js status

# Generate reports
node accountability/cli.js weekly-report
node accountability/cli.js trainer-report

# Change phase
node accountability/cli.js phase 2

# Plan week (auto-fills from recommended slots)
node accountability/cli.js plan-week

# Run pattern detection
node accountability/cli.js detect-patterns

# Reset database (fresh start)
node accountability/cli.js reset-db
```

## Boxing Gym Schedule (After-Work Focus)

### Recommended Slots

**Phase 1**: Tuesday 6pm Boxing Basics + Thursday gym
**Phase 2**: Tuesday + Thursday 6pm Boxing Basics + Saturday gym
**Phase 3**: Tuesday Boxing Basics + Thursday Skills & Drills + Monday + Saturday gym

### Full After-Work Timetable

| Time | Mon | Tue | Wed | Thu | Fri |
|------|-----|-----|-----|-----|-----|
| 5:00-5:45pm | Bag+45 | Bag+45, Padwork+45 | Bag+45 | Bag+45, Padwork+45 | Bag+45 |
| 6:00-7:00pm | Basics, Sparring, Padwork+60 | Basics, Skills | Basics, Sparring, Padwork+60 | Basics, Skills | Sparring |
| 7:00-7:45pm | Padwork+45 | Bag+45 | Padwork+45 | Bag+45 | — |

**Backup**: Lunch classes 12-1pm Mon-Fri (Boxing Skills & Drills)

## Trainer Integration

Before each fortnightly trainer session, run:
```bash
node accountability/cli.js trainer-report
```

This generates a 2-week summary with:
- Sessions completed (boxing + gym)
- Sleep compliance
- Pattern events
- Streaks

Share this with your trainer so they can adjust the program based on real data.

## Technical Notes

- **Database**: SQLite with WAL mode (per OpenClaw convention)
- **JavaScript**: CommonJS, `'use strict'`, no ES modules
- **Telegram**: Uses native `https` module (no new dependencies)
- **Bot token**: Read from `~/.openclaw/openclaw.json` (same as other scripts)
- **Chat ID**: `5014458510` (Jeff's Telegram)
- **All times**: Australia/Melbourne timezone
