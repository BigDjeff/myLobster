'use strict';

/**
 * bot.js — Main accountability bot process.
 *
 * Runs as a standalone Node.js process:
 *   node accountability/bot.js start    — start polling + scheduler
 *   node accountability/bot.js stop     — graceful shutdown (via signal)
 *   node accountability/bot.js status   — check if running
 *
 * This process:
 * 1. Polls Telegram for user replies every 3 seconds
 * 2. Runs scheduled check-ins every 60 seconds
 * 3. Logs all activity to the contained habits.db
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

    try {
      const results = await scheduler.runScheduledCheckins();
      if (results.length > 0) {
        log('INFO', `Scheduler sent: ${results.join(', ')}`);
      }
    } catch (err) {
      log('ERROR', `Scheduler error: ${err.message}`);
    }

    _schedulerTimer = setTimeout(schedulerLoop, 60000);
  }

  // Start both loops
  pollLoop();
  schedulerLoop();

  log('INFO', 'Bot loops started. Waiting for messages...');
}

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
    console.log(`Accountability bot is running (PID: ${status.pid})`);
  } else {
    console.log('Accountability bot is not running');
  }
} else {
  console.log('Usage: node accountability/bot.js [start|stop|status]');
  console.log('');
  console.log('  start   — Start the accountability bot');
  console.log('  stop    — Stop the running bot');
  console.log('  status  — Check if the bot is running');
}
