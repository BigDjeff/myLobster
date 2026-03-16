'use strict';

/**
 * habit-db.js — SQLite database layer for the accountability module.
 *
 * Isolated database at accountability/data/habits.db.
 * Does NOT touch workspace/data/ databases.
 * Uses WAL mode per OpenClaw convention.
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'data', 'habits.db');
let _db = null;

// ── Database Connection ──────────────────────────────────────────────────────

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _initSchema(_db);
  return _db;
}

function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ── Schema ───────────────────────────────────────────────────────────────────

function _initSchema(db) {
  db.exec(`
    -- Current phase and start date
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Planned sessions for the week (what the user committed to)
    CREATE TABLE IF NOT EXISTS planned_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start  TEXT NOT NULL,
      day         TEXT NOT NULL,
      session_type TEXT NOT NULL,  -- boxing | gym
      class_name  TEXT,
      start_time  TEXT,
      status      TEXT DEFAULT 'planned',  -- planned | confirmed | completed | skipped | rescheduled
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT
    );

    -- Actual session completions (logged by user)
    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      date         TEXT NOT NULL,
      session_type TEXT NOT NULL,  -- boxing | gym
      class_name   TEXT,
      duration_min INTEGER,
      notes        TEXT,
      logged_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Bedtime check-ins
    CREATE TABLE IF NOT EXISTS sleep_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      date            TEXT NOT NULL UNIQUE,
      nudge_sent_at   TEXT,
      nudge_replied   INTEGER DEFAULT 0,
      lights_out_at   TEXT,
      is_late         INTEGER DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Check-in events (all bot interactions)
    CREATE TABLE IF NOT EXISTS check_ins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,  -- bedtime_nudge | bedtime_escalation | morning_plan | pre_session | pre_session_followup | weekly_report
      date        TEXT NOT NULL,
      sent_at     TEXT NOT NULL,
      reply       TEXT,
      replied_at  TEXT,
      status      TEXT DEFAULT 'sent'  -- sent | replied | expired
    );

    -- Pattern detection events
    CREATE TABLE IF NOT EXISTS pattern_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_type  TEXT NOT NULL,  -- consecutive_skips | late_bedtimes | declining_trend
      details       TEXT,
      intervention  TEXT,
      triggered_at  TEXT NOT NULL DEFAULT (datetime('now')),
      acknowledged  INTEGER DEFAULT 0
    );

    -- Streak tracking (computed but cached for quick access)
    CREATE TABLE IF NOT EXISTS streaks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      streak_type  TEXT NOT NULL,  -- sessions | bedtime
      current      INTEGER DEFAULT 0,
      best         INTEGER DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
    CREATE INDEX IF NOT EXISTS idx_sleep_logs_date ON sleep_logs(date);
    CREATE INDEX IF NOT EXISTS idx_check_ins_date ON check_ins(date);
    CREATE INDEX IF NOT EXISTS idx_planned_sessions_week ON planned_sessions(week_start);
  `);

  // Seed default config if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM config').get();
  if (count.c === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
    insert.run('current_phase', '1');
    insert.run('phase_start_date', new Date().toISOString().split('T')[0]);
    insert.run('bot_last_update_id', '0');
  }
}

// ── Config Helpers ───────────────────────────────────────────────────────────

function getConfig(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

// ── Session Logging ──────────────────────────────────────────────────────────

function logSession({ date, sessionType, className, durationMin, notes }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sessions (date, session_type, class_name, duration_min, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(date, sessionType, className || null, durationMin || null, notes || null);
  _updateSessionStreak();
  return result.lastInsertRowid;
}

function getSessionsInRange(startDate, endDate) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sessions WHERE date >= ? AND date <= ? ORDER BY date
  `).all(startDate, endDate);
}

function getSessionCountThisWeek(weekStart) {
  const db = getDb();
  const endDate = _addDays(weekStart, 6);
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN session_type = 'boxing' THEN 1 ELSE 0 END) as boxing,
      SUM(CASE WHEN session_type = 'gym' THEN 1 ELSE 0 END) as gym
    FROM sessions WHERE date >= ? AND date <= ?
  `).get(weekStart, endDate);
  return { total: row.total, boxing: row.boxing || 0, gym: row.gym || 0 };
}

// ── Planned Sessions ─────────────────────────────────────────────────────────

function planSession({ weekStart, day, sessionType, className, startTime }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO planned_sessions (week_start, day, session_type, class_name, start_time)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(weekStart, day, sessionType, className || null, startTime || null).lastInsertRowid;
}

function updatePlannedSession(id, status) {
  const db = getDb();
  db.prepare(`
    UPDATE planned_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, id);
}

function getPlannedSessionsForWeek(weekStart) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM planned_sessions WHERE week_start = ? ORDER BY
      CASE day
        WHEN 'mon' THEN 1 WHEN 'tue' THEN 2 WHEN 'wed' THEN 3
        WHEN 'thu' THEN 4 WHEN 'fri' THEN 5 WHEN 'sat' THEN 6 WHEN 'sun' THEN 7
      END
  `).all(weekStart);
}

function getTodayPlannedSession(today, dayName) {
  const db = getDb();
  // Get the week start (Monday) for today
  const weekStart = _getWeekStart(today);
  return db.prepare(`
    SELECT * FROM planned_sessions
    WHERE week_start = ? AND day = ? AND status IN ('planned', 'confirmed')
    ORDER BY start_time
  `).all(weekStart, dayName);
}

// ── Sleep Logs ───────────────────────────────────────────────────────────────

function logSleepNudge(date) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO sleep_logs (date, nudge_sent_at)
    VALUES (?, datetime('now'))
  `).run(date);
}

function logSleepReply(date) {
  const db = getDb();
  db.prepare(`
    UPDATE sleep_logs SET nudge_replied = 1 WHERE date = ?
  `).run(date);
}

function logLightsOut(date, isLate) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sleep_logs (date, lights_out_at, is_late)
    VALUES (?, datetime('now'), ?)
    ON CONFLICT(date) DO UPDATE SET lights_out_at = datetime('now'), is_late = ?
  `).run(date, isLate ? 1 : 0, isLate ? 1 : 0);
  _updateBedtimeStreak(isLate);
}

function getLateBedtimesThisWeek(weekStart) {
  const db = getDb();
  const endDate = _addDays(weekStart, 6);
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM sleep_logs
    WHERE date >= ? AND date <= ? AND is_late = 1
  `).get(weekStart, endDate);
  return row.count;
}

function getRecentSleepLogs(days) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sleep_logs ORDER BY date DESC LIMIT ?
  `).all(days);
}

// ── Check-ins ────────────────────────────────────────────────────────────────

function logCheckIn({ type, date, sentAt }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO check_ins (type, date, sent_at)
    VALUES (?, ?, ?)
  `).run(type, date, sentAt).lastInsertRowid;
}

function updateCheckInReply(id, reply) {
  const db = getDb();
  db.prepare(`
    UPDATE check_ins SET reply = ?, replied_at = datetime('now'), status = 'replied'
    WHERE id = ?
  `).run(reply, id);
}

function getLastCheckIn(type) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM check_ins WHERE type = ? ORDER BY sent_at DESC LIMIT 1
  `).get(type);
}

function getPendingCheckIns() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM check_ins WHERE status = 'sent' ORDER BY sent_at DESC
  `).all();
}

// ── Pattern Events ───────────────────────────────────────────────────────────

function logPatternEvent({ patternType, details, intervention }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO pattern_events (pattern_type, details, intervention)
    VALUES (?, ?, ?)
  `).run(patternType, details || null, intervention || null).lastInsertRowid;
}

function getRecentPatternEvents(days) {
  const db = getDb();
  const cutoff = _addDays(_today(), -days);
  return db.prepare(`
    SELECT * FROM pattern_events WHERE triggered_at >= ? ORDER BY triggered_at DESC
  `).all(cutoff);
}

// ── Streaks ──────────────────────────────────────────────────────────────────

function getStreak(streakType) {
  const db = getDb();
  let row = db.prepare('SELECT * FROM streaks WHERE streak_type = ?').get(streakType);
  if (!row) {
    db.prepare(`
      INSERT INTO streaks (streak_type, current, best) VALUES (?, 0, 0)
    `).run(streakType);
    row = { current: 0, best: 0 };
  }
  return { current: row.current, best: row.best };
}

function _updateSessionStreak() {
  const db = getDb();
  // Count consecutive weeks with at least 1 session
  const sessions = db.prepare(`
    SELECT DISTINCT strftime('%W', date) as week_num FROM sessions
    ORDER BY date DESC LIMIT 52
  `).all();

  const currentWeek = _currentWeekNum();
  let streak = 0;
  for (let i = 0; i < sessions.length; i++) {
    const expectedWeek = currentWeek - i;
    if (parseInt(sessions[i].week_num) === expectedWeek) {
      streak++;
    } else {
      break;
    }
  }

  const existing = db.prepare('SELECT best FROM streaks WHERE streak_type = ?').get('sessions');
  const best = existing ? Math.max(existing.best, streak) : streak;

  db.prepare(`
    INSERT INTO streaks (streak_type, current, best, last_updated)
    VALUES ('sessions', ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET current = ?, best = ?, last_updated = datetime('now')
  `).run(streak, best, streak, best);
}

function _updateBedtimeStreak(isLate) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM streaks WHERE streak_type = ?').get('bedtime');

  if (!existing) {
    db.prepare(`
      INSERT INTO streaks (streak_type, current, best) VALUES ('bedtime', ?, ?)
    `).run(isLate ? 0 : 1, isLate ? 0 : 1);
    return;
  }

  const newCurrent = isLate ? 0 : existing.current + 1;
  const newBest = Math.max(existing.best, newCurrent);

  db.prepare(`
    UPDATE streaks SET current = ?, best = ?, last_updated = datetime('now')
    WHERE streak_type = 'bedtime'
  `).run(newCurrent, newBest);
}

// ── Stats / Reports ──────────────────────────────────────────────────────────

function getWeeklyStats(weekStart) {
  const db = getDb();
  const endDate = _addDays(weekStart, 6);

  const sessions = getSessionCountThisWeek(weekStart);
  const lateBedtimes = getLateBedtimesThisWeek(weekStart);
  const planned = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
    FROM planned_sessions WHERE week_start = ?
  `).get(weekStart);

  const checkIns = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied
    FROM check_ins WHERE date >= ? AND date <= ?
  `).get(weekStart, endDate);

  const phase = parseInt(getConfig('current_phase') || '1');

  return {
    weekStart,
    phase,
    sessions,
    planned: { total: planned.total, completed: planned.completed || 0, skipped: planned.skipped || 0 },
    lateBedtimes,
    checkIns: { total: checkIns.total, replied: checkIns.replied || 0 },
    streaks: {
      sessions: getStreak('sessions'),
      bedtime: getStreak('bedtime'),
    },
  };
}

function getConsecutiveSkips() {
  const db = getDb();
  const recent = db.prepare(`
    SELECT status FROM planned_sessions
    WHERE status IN ('completed', 'skipped')
    ORDER BY updated_at DESC LIMIT 10
  `).all();

  let skips = 0;
  for (const row of recent) {
    if (row.status === 'skipped') {
      skips++;
    } else {
      break;
    }
  }
  return skips;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _today() {
  return new Date().toISOString().split('T')[0];
}

function _addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function _getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday = start
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

function _currentWeekNum() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}

module.exports = {
  getDb,
  closeDb,
  // Config
  getConfig,
  setConfig,
  // Sessions
  logSession,
  getSessionsInRange,
  getSessionCountThisWeek,
  // Planned sessions
  planSession,
  updatePlannedSession,
  getPlannedSessionsForWeek,
  getTodayPlannedSession,
  // Sleep
  logSleepNudge,
  logSleepReply,
  logLightsOut,
  getLateBedtimesThisWeek,
  getRecentSleepLogs,
  // Check-ins
  logCheckIn,
  updateCheckInReply,
  getLastCheckIn,
  getPendingCheckIns,
  // Patterns
  logPatternEvent,
  getRecentPatternEvents,
  // Streaks
  getStreak,
  // Stats
  getWeeklyStats,
  getConsecutiveSkips,
};
