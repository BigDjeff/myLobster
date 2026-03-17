'use strict';

/**
 * bot.js — Main accountability bot process.
 *
 * Runs as a background daemon:
 *   scripts/accountability-bot.sh start     — start in background (recommended)
 *   scripts/accountability-bot.sh stop      — graceful shutdown
 *   scripts/accountability-bot.sh kill      — force kill (SIGKILL)
 *   scripts/accountability-bot.sh restart   — stop + start
 *   scripts/accountability-bot.sh status    — check if running
 *
 * Or via node directly:
 *   node accountability/bot.js start      — start (foreground)
 *   node accountability/bot.js stop       — send SIGTERM to running bot
 *   node accountability/bot.js status     — check if running
 *   node accountability/bot.js activate   — set state to ACTIVE (DB only)
 *   node accountability/bot.js deactivate — set state to INACTIVE (DB only)
 *
 * Telegram commands (while bot process is running):
 *   /acc start   — activate check-ins & reply processing
 *   /acc stop    — deactivate (bot process stays alive, stops processing)
 *   /acc kill    — shut down the bot process entirely
 *   /acc status  — show bot state
 *   /acc help    — show available commands
 *
 * The bot has two states:
 * - ACTIVE: polls Telegram, processes replies, sends scheduled check-ins
 * - INACTIVE: polls Telegram for /acc commands only, ignores everything else
 *
 * Does NOT interact with any other OpenClaw modules.
 */

const fs = require('fs');
const path = require('path');
const habitDb = require('./habit-db');
const telegram = require('./telegram');
const scheduler = require('./scheduler');
const { TELEGRAM } = require('./config');

const PID_FILE = path.join(__dirname, 'data', 'bot.pid');
const LOG_FILE = path.join(__dirname, 'data', 'bot.log');

// ── Logging ──────────────────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {
    // best-effort logging
  }
}

// ── Bot State ────────────────────────────────────────────────────────────────

function _isActive() {
  return habitDb.getConfig('bot_active') === 'true';
}

function _setActive(active) {
  habitDb.setConfig('bot_active', active ? 'true' : 'false');
}

// ── Bot Process ──────────────────────────────────────────────────────────────

let _running = false;
let _pollTimer = null;
let _schedulerTimer = null;

async function start() {
  if (_running) {
    log('WARN', 'Bot is already running');
    return;
  }

  // Write PID file
  fs.writeFileSync(PID_FILE, String(process.pid));
  _running = true;

  log('INFO', `Accountability bot started (PID: ${process.pid})`);
  log('INFO', `Database: ${path.join(__dirname, 'data', 'habits.db')}`);
  log('INFO', `Polling interval: ${TELEGRAM.pollingIntervalMs}ms`);

  // Initialize database
  habitDb.getDb();
  log('INFO', 'Database initialized');

  // Verify Telegram connection
  try {
    telegram.getBotToken();
    log('INFO', 'Telegram bot token loaded');
  } catch (err) {
    log('ERROR', `Failed to load Telegram token: ${err.message}`);
    log('ERROR', 'Bot cannot function without Telegram. Exiting.');
    stop(1);
    return;
  }

  // Check initial active state
  const active = _isActive();
  log('INFO', `Bot state: ${active ? 'ACTIVE' : 'INACTIVE'}`);
  if (!active) {
    log('INFO', 'Bot is inactive. Send /acc start via Telegram to activate.');
  }

  // Get last update ID to avoid processing old messages
  let lastUpdateId = parseInt(habitDb.getConfig('bot_last_update_id') || '0');
  log('INFO', `Resuming from update ID: ${lastUpdateId}`);

  // ── Telegram Polling Loop ──────────────────────────────────────────────
  async function pollLoop() {
    if (!_running) return;

    try {
      const result = await telegram.pollMessages(lastUpdateId);

      if (result.lastUpdateId > lastUpdateId) {
        lastUpdateId = result.lastUpdateId;
        habitDb.setConfig('bot_last_update_id', String(lastUpdateId));
      }

      for (const msg of result.messages) {
        log('INFO', `Received: "${msg.text}" at ${msg.date}`);

        // Always check for /acc bot commands first (works in both active and inactive state)
        const botCmd = _parseBotCommand(msg.text);
        if (botCmd) {
          try {
            const action = await _handleBotCommand(botCmd);
            log('INFO', `Bot command: ${action}`);
            if (action === 'killed') return; // process is shutting down
          } catch (err) {
            log('ERROR', `Failed to handle bot command: ${err.message}`);
          }
          continue;
        }

        // Only process accountability replies when active
        if (!_isActive()) {
          log('INFO', `Ignored (bot inactive): "${msg.text}"`);
          continue;
        }

        try {
          const action = await scheduler.processReply(msg.text);
          if (action) {
            log('INFO', `Processed reply as: ${action}`);
          } else {
            log('INFO', `Unrecognized reply: "${msg.text}"`);
          }
        } catch (err) {
          log('ERROR', `Failed to process reply: ${err.message}`);
        }
      }
    } catch (err) {
      log('ERROR', `Poll error: ${err.message}`);
    }

    _pollTimer = setTimeout(pollLoop, TELEGRAM.pollingIntervalMs);
  }

  // ── Scheduler Loop (every 60 seconds) ──────────────────────────────────
  async function schedulerLoop() {
    if (!_running) return;

    // Only run scheduled check-ins when active
    if (_isActive()) {
      try {
        const results = await scheduler.runScheduledCheckins();
        if (results.length > 0) {
          log('INFO', `Scheduler sent: ${results.join(', ')}`);
        }
      } catch (err) {
        log('ERROR', `Scheduler error: ${err.message}`);
      }
    }

    _schedulerTimer = setTimeout(schedulerLoop, 60000);
  }

  // Start both loops
  pollLoop();
  schedulerLoop();

  log('INFO', 'Bot loops started. Listening for /acc commands...');
}

// ── Bot Command Handling ────────────────────────────────────────────────────

function _parseBotCommand(text) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('/acc')) {
    const parts = trimmed.split(/\s+/);
    return parts[1] || 'help'; // default to help if just "/acc"
  }
  return null;
}

async function _handleBotCommand(command) {
  switch (command) {
    case 'start':
    case 'on':
    case 'activate': {
      if (_isActive()) {
        await telegram.sendMessage('Accountability bot is already *active*.\n\nSend /acc stop to deactivate.');
        return 'already_active';
      }
      _setActive(true);
      log('INFO', 'Bot activated via Telegram');
      await telegram.sendMessage(
        '*Accountability bot activated.*\n\n' +
        'Check-ins and reply processing are now ON.\n' +
        'Send /acc stop to deactivate.\n' +
        'Send /acc help for all commands.'
      );
      return 'activated';
    }

    case 'stop':
    case 'pause':
    case 'off':
    case 'deactivate': {
      if (!_isActive()) {
        await telegram.sendMessage('Accountability bot is already *inactive*.\n\nSend /acc start to activate.');
        return 'already_inactive';
      }
      _setActive(false);
      log('INFO', 'Bot deactivated via Telegram');
      await telegram.sendMessage(
        '*Accountability bot deactivated.*\n\n' +
        'Check-ins and reply processing are now OFF.\n' +
        'The bot process is still running — send /acc start to reactivate.\n' +
        'Send /acc kill to shut down the bot process entirely.'
      );
      return 'deactivated';
    }

    case 'kill':
    case 'quit':
    case 'shutdown': {
      _setActive(false);
      log('INFO', 'Bot killed via Telegram');
      await telegram.sendMessage(
        '*Accountability bot shutting down.*\n\n' +
        'The bot process is being terminated.\n' +
        'To restart, run from terminal:\n' +
        '`scripts/accountability-bot.sh start`'
      );
      // Give Telegram time to deliver the message before shutting down
      setTimeout(() => stop(0), 1500);
      return 'killed';
    }

    case 'status': {
      const active = _isActive();
      const pid = process.pid;
      const uptime = process.uptime();
      const hrs = Math.floor(uptime / 3600);
      const mins = Math.floor((uptime % 3600) / 60);

      let statusMsg = '*Accountability Bot Status*\n\n';
      statusMsg += `State: ${active ? 'ACTIVE' : 'INACTIVE'}\n`;
      statusMsg += `PID: ${pid}\n`;
      statusMsg += `Uptime: ${hrs}h ${mins}m\n`;

      if (active) {
        try {
          const weekStart = _getWeekStart();
          const stats = habitDb.getWeeklyStats(weekStart);
          statusMsg += `\nThis week: ${stats.sessions.total} sessions`;
          statusMsg += `\nStreak: ${stats.streaks.sessions.current} weeks`;
        } catch (_) {
          // stats not available
        }
      }

      statusMsg += '\n\nCommands: /acc start | stop | kill | status | help';
      await telegram.sendMessage(statusMsg);
      return 'status';
    }

    case 'help':
    default: {
      await telegram.sendMessage(
        '*Accountability Bot Commands*\n\n' +
        '*Bot control:*\n' +
        '/acc start — activate check-ins & replies\n' +
        '/acc stop — deactivate (process stays alive)\n' +
        '/acc kill — shut down bot process\n' +
        '/acc status — show bot state\n' +
        '/acc help — this menu\n\n' +
        '*When active, reply keywords:*\n' +
        'CONFIRM — lock in today\'s session\n' +
        'HEADING OUT — on your way to gym\n' +
        'DONE — log a completed session\n' +
        'SKIP — skip today\n' +
        'RESCHEDULE — move session\n' +
        'LIGHTS OUT — confirm bedtime\n' +
        'STATUS — see progress\n' +
        'HELP — show keyword help'
      );
      return 'help';
    }
  }
}

function _getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().split('T')[0];
}

// ── Shutdown ────────────────────────────────────────────────────────────────

function stop(code) {
  if (!_running) return;
  _running = false;

  if (_pollTimer) clearTimeout(_pollTimer);
  if (_schedulerTimer) clearTimeout(_schedulerTimer);

  habitDb.closeDb();

  // Remove PID file
  try {
    fs.unlinkSync(PID_FILE);
  } catch (_) {
    // ignore
  }

  log('INFO', 'Bot stopped gracefully');
  process.exit(code || 0);
}

function isRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    // Check if process exists
    process.kill(pid, 0);
    return { running: true, pid };
  } catch (_) {
    return { running: false, pid: null };
  }
}

// ── Signal Handling ──────────────────────────────────────────────────────────

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('uncaughtException', (err) => {
  log('ERROR', `Uncaught exception: ${err.message}`);
  log('ERROR', err.stack);
  stop(1);
});

// ── CLI Entry Point ──────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === 'start') {
  start();
} else if (command === 'stop') {
  const status = isRunning();
  if (status.running) {
    log('INFO', `Sending SIGTERM to PID ${status.pid}`);
    process.kill(status.pid, 'SIGTERM');
  } else {
    log('INFO', 'Bot is not running');
  }
} else if (command === 'status') {
  const status = isRunning();
  if (status.running) {
    habitDb.getDb();
    const active = habitDb.getConfig('bot_active') === 'true';
    console.log(`Accountability bot is running (PID: ${status.pid}), state: ${active ? 'ACTIVE' : 'INACTIVE'}`);
    habitDb.closeDb();
  } else {
    console.log('Accountability bot is not running');
  }
} else if (command === 'activate') {
  habitDb.getDb();
  habitDb.setConfig('bot_active', 'true');
  console.log('Bot state set to ACTIVE');
  habitDb.closeDb();
} else if (command === 'deactivate') {
  habitDb.getDb();
  habitDb.setConfig('bot_active', 'false');
  console.log('Bot state set to INACTIVE');
  habitDb.closeDb();
} else {
  console.log('Usage: node accountability/bot.js [command]');
  console.log('');
  console.log('  start      — Start the accountability bot');
  console.log('  stop       — Stop the running bot (SIGTERM)');
  console.log('  status     — Check if running and active state');
  console.log('  activate   — Set bot state to ACTIVE (DB only)');
  console.log('  deactivate — Set bot state to INACTIVE (DB only)');
  console.log('');
  console.log('Recommended: Use scripts/accountability-bot.sh for daemon management.');
  console.log('');
  console.log('Telegram commands (while running):');
  console.log('  /acc start  — activate check-ins & replies');
  console.log('  /acc stop   — deactivate (process stays alive)');
  console.log('  /acc kill   — shut down bot process');
  console.log('  /acc status — show bot state');
  console.log('  /acc help   — show all commands');
}
