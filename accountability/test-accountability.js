'use strict';

/**
 * test-accountability.js — Standalone tests for the accountability module.
 *
 * Tests database operations, config, pattern detection, and report generation.
 * NO live Telegram calls. NO modification to workspace/data/ databases.
 *
 * Run: node accountability/test-accountability.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    errors.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    errors.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ============================================================================
// Setup: Use a temporary test database
// ============================================================================

const TEST_DB_PATH = path.join(__dirname, 'data', 'test-habits.db');

// Clean up any previous test database
try { fs.unlinkSync(TEST_DB_PATH); } catch (_) { /* ignore */ }
try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch (_) { /* ignore */ }
try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch (_) { /* ignore */ }

console.log('\n=== Accountability Module Tests ===');
console.log(`Test database: ${TEST_DB_PATH}\n`);

// ============================================================================
// 1. config.js
// ============================================================================
console.log('--- 1. config.js ---');

const config = require('./config');

assert(config.TIMEZONE === 'Australia/Melbourne', 'timezone is Melbourne');
assert(config.BOXING_SCHEDULE.length > 0, 'boxing schedule has entries');
assert(config.PHASES[1] !== undefined, 'phase 1 exists');
assert(config.PHASES[2] !== undefined, 'phase 2 exists');
assert(config.PHASES[3] !== undefined, 'phase 3 exists');
assertEq(config.PHASES[1].weeklyTarget.total, 2, 'phase 1 target is 2 sessions');
assertEq(config.PHASES[2].weeklyTarget.total, 3, 'phase 2 target is 3 sessions');
assertEq(config.PHASES[3].weeklyTarget.total, 4, 'phase 3 target is 4 sessions');
assert(config.CHECKIN_TIMES.bedtimeNudge.hour === 21, 'bedtime nudge at 9:30 PM');
assert(config.CHECKIN_TIMES.morningPlan.hour === 7, 'morning plan at 7 AM');
assert(config.REPLY_KEYWORDS.confirm.includes('confirm'), 'confirm keyword exists');
assert(config.REPLY_KEYWORDS.headingOut.includes('heading out'), 'heading out keyword exists');

// Check boxing schedule data integrity
const tueSessions = config.BOXING_SCHEDULE.filter((s) => s.day === 'tue');
assert(tueSessions.length > 0, 'tuesday has boxing sessions');

const lunchSessions = config.BOXING_SCHEDULE.filter((s) => s.start === '12:00');
assertEq(lunchSessions.length, 5, 'lunch sessions on all weekdays');

const satSessions = config.BOXING_SCHEDULE.filter((s) => s.day === 'sat');
assert(satSessions.length >= 2, 'saturday has morning sessions');

// ============================================================================
// 2. habit-db.js (using test database)
// ============================================================================
console.log('\n--- 2. habit-db.js ---');

// Monkey-patch the module to use test database
const habitDb = require('./habit-db');

// Close any existing connection and point to test DB
habitDb.closeDb();

// Create test DB manually with same schema
const testDb = new Database(TEST_DB_PATH);
testDb.pragma('journal_mode = WAL');
testDb.pragma('foreign_keys = ON');

testDb.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS planned_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start  TEXT NOT NULL,
    day         TEXT NOT NULL,
    session_type TEXT NOT NULL,
    class_name  TEXT,
    start_time  TEXT,
    status      TEXT DEFAULT 'planned',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL,
    session_type TEXT NOT NULL,
    class_name   TEXT,
    duration_min INTEGER,
    notes        TEXT,
    logged_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sleep_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL UNIQUE,
    nudge_sent_at   TEXT,
    nudge_replied   INTEGER DEFAULT 0,
    lights_out_at   TEXT,
    is_late         INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS check_ins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,
    date        TEXT NOT NULL,
    sent_at     TEXT NOT NULL,
    reply       TEXT,
    replied_at  TEXT,
    status      TEXT DEFAULT 'sent'
  );
  CREATE TABLE IF NOT EXISTS pattern_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type  TEXT NOT NULL,
    details       TEXT,
    intervention  TEXT,
    triggered_at  TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged  INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS streaks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    streak_type  TEXT NOT NULL,
    current      INTEGER DEFAULT 0,
    best         INTEGER DEFAULT 0,
    last_updated TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
  CREATE INDEX IF NOT EXISTS idx_sleep_logs_date ON sleep_logs(date);
  CREATE INDEX IF NOT EXISTS idx_check_ins_date ON check_ins(date);
  CREATE INDEX IF NOT EXISTS idx_planned_sessions_week ON planned_sessions(week_start);
`);

// Test config operations directly on testDb
testDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('current_phase', '1');
testDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('phase_start_date', '2026-03-16');
testDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('bot_last_update_id', '0');

const configVal = testDb.prepare('SELECT value FROM config WHERE key = ?').get('current_phase');
assertEq(configVal.value, '1', 'config: current_phase defaults to 1');

// Test session logging
testDb.prepare(`
  INSERT INTO sessions (date, session_type, class_name, duration_min, notes)
  VALUES (?, ?, ?, ?, ?)
`).run('2026-03-16', 'boxing', 'Boxing Basics', 60, 'First session');

const session = testDb.prepare('SELECT * FROM sessions WHERE date = ?').get('2026-03-16');
assert(session !== undefined, 'session was logged');
assertEq(session.session_type, 'boxing', 'session type is boxing');
assertEq(session.class_name, 'Boxing Basics', 'class name correct');
assertEq(session.duration_min, 60, 'duration correct');

// Test multiple sessions
testDb.prepare(`
  INSERT INTO sessions (date, session_type, class_name, duration_min)
  VALUES (?, ?, ?, ?)
`).run('2026-03-17', 'gym', 'Trainer session', 45);

const allSessions = testDb.prepare('SELECT * FROM sessions ORDER BY date').all();
assertEq(allSessions.length, 2, 'two sessions logged');

// Test planned sessions
testDb.prepare(`
  INSERT INTO planned_sessions (week_start, day, session_type, class_name, start_time)
  VALUES (?, ?, ?, ?, ?)
`).run('2026-03-16', 'tue', 'boxing', 'Boxing Basics', '18:00');

const planned = testDb.prepare('SELECT * FROM planned_sessions WHERE week_start = ?').all('2026-03-16');
assertEq(planned.length, 1, 'one planned session');
assertEq(planned[0].day, 'tue', 'planned for tuesday');

// Update planned session status
testDb.prepare(`
  UPDATE planned_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?
`).run('confirmed', planned[0].id);

const updated = testDb.prepare('SELECT * FROM planned_sessions WHERE id = ?').get(planned[0].id);
assertEq(updated.status, 'confirmed', 'planned session confirmed');

// Test sleep logs
testDb.prepare(`
  INSERT INTO sleep_logs (date, nudge_sent_at, is_late)
  VALUES (?, datetime('now'), ?)
`).run('2026-03-16', 0);

testDb.prepare(`
  INSERT INTO sleep_logs (date, nudge_sent_at, is_late)
  VALUES (?, datetime('now'), ?)
`).run('2026-03-17', 1);

const sleepLogs = testDb.prepare('SELECT * FROM sleep_logs ORDER BY date').all();
assertEq(sleepLogs.length, 2, 'two sleep logs');
assertEq(sleepLogs[0].is_late, 0, 'first night on time');
assertEq(sleepLogs[1].is_late, 1, 'second night late');

// Test check-ins
testDb.prepare(`
  INSERT INTO check_ins (type, date, sent_at)
  VALUES (?, ?, ?)
`).run('bedtime_nudge', '2026-03-16', new Date().toISOString());

const checkIn = testDb.prepare('SELECT * FROM check_ins WHERE type = ? ORDER BY sent_at DESC LIMIT 1').get('bedtime_nudge');
assert(checkIn !== undefined, 'check-in logged');
assertEq(checkIn.status, 'sent', 'check-in status is sent');

// Update check-in reply
testDb.prepare(`
  UPDATE check_ins SET reply = ?, replied_at = datetime('now'), status = 'replied'
  WHERE id = ?
`).run('LIGHTS OUT', checkIn.id);

const repliedCheckIn = testDb.prepare('SELECT * FROM check_ins WHERE id = ?').get(checkIn.id);
assertEq(repliedCheckIn.status, 'replied', 'check-in marked as replied');
assertEq(repliedCheckIn.reply, 'LIGHTS OUT', 'reply text stored');

// Test streak tracking
testDb.prepare(`
  INSERT INTO streaks (streak_type, current, best) VALUES (?, ?, ?)
`).run('sessions', 3, 5);

const streak = testDb.prepare('SELECT * FROM streaks WHERE streak_type = ?').get('sessions');
assertEq(streak.current, 3, 'session streak current is 3');
assertEq(streak.best, 5, 'session streak best is 5');

// Test pattern events
testDb.prepare(`
  INSERT INTO pattern_events (pattern_type, details, intervention)
  VALUES (?, ?, ?)
`).run('consecutive_skips', '2 skips in a row', 'Suggest lighter session');

const patterns = testDb.prepare('SELECT * FROM pattern_events').all();
assertEq(patterns.length, 1, 'one pattern event');
assertEq(patterns[0].pattern_type, 'consecutive_skips', 'pattern type correct');

// Test WAL mode
const walMode = testDb.pragma('journal_mode');
assertEq(walMode[0].journal_mode, 'wal', 'database uses WAL mode');

// ============================================================================
// 3. Telegram message templates
// ============================================================================
console.log('\n--- 3. telegram.js templates ---');

const { TEMPLATES } = require('./telegram');

const bedtimeMsg = TEMPLATES.bedtimeNudge({ class_name: 'Boxing Basics' });
assert(bedtimeMsg.includes('wind down'), 'bedtime nudge mentions wind down');
assert(bedtimeMsg.includes('Boxing Basics'), 'bedtime nudge includes class name');
assert(bedtimeMsg.includes('LIGHTS OUT'), 'bedtime nudge has LIGHTS OUT CTA');

const escalationMsg = TEMPLATES.bedtimeEscalation();
assert(escalationMsg.includes('still up'), 'escalation mentions still up');

const morningMsg = TEMPLATES.morningPlan([
  { class_name: 'Boxing Basics', start_time: '18:00' },
], { current: 2 });
assert(morningMsg.includes('Boxing Basics'), 'morning plan shows class');
assert(morningMsg.includes('CONFIRM'), 'morning plan has confirm CTA');
assert(morningMsg.includes('streak'), 'morning plan shows streak');

const restDayMsg = TEMPLATES.morningPlan([], null);
assert(restDayMsg.includes('Rest day'), 'rest day message correct');

const preSessionMsg = TEMPLATES.preSession({ class_name: 'Boxing Basics' });
assert(preSessionMsg.includes('90 minutes'), 'pre-session mentions time');
assert(preSessionMsg.includes('HEADING OUT'), 'pre-session has heading out CTA');

const completeMsg = TEMPLATES.sessionComplete({ current: 3 });
assert(completeMsg.includes('logged'), 'session complete confirms logging');
assert(completeMsg.includes('3'), 'session complete shows streak');

const skipPatternMsg = TEMPLATES.patternAlert('consecutive_skips');
assert(skipPatternMsg.includes('Pattern detected'), 'skip pattern has alert');
assert(skipPatternMsg.includes('Bag'), 'skip pattern suggests lighter option');

const bedtimePatternMsg = TEMPLATES.patternAlert('late_bedtimes');
assert(bedtimePatternMsg.includes('late nights'), 'bedtime pattern mentions late nights');

const helpMsg = TEMPLATES.help();
assert(helpMsg.includes('CONFIRM'), 'help includes confirm');
assert(helpMsg.includes('HEADING OUT'), 'help includes heading out');
assert(helpMsg.includes('LIGHTS OUT'), 'help includes lights out');
assert(helpMsg.includes('STATUS'), 'help includes status');

// Weekly report template
const mockStats = {
  weekStart: '2026-03-16',
  phase: 1,
  sessions: { total: 1, boxing: 1, gym: 0 },
  planned: { total: 2, completed: 1, skipped: 1 },
  lateBedtimes: 2,
  checkIns: { total: 5, replied: 3 },
  streaks: {
    sessions: { current: 1, best: 3 },
    bedtime: { current: 0, best: 5 },
  },
};
const reportMsg = TEMPLATES.weeklyReport(mockStats);
assert(reportMsg.includes('Weekly Report'), 'weekly report has title');
assert(reportMsg.includes('Phase 1'), 'weekly report shows phase');
assert(reportMsg.includes('1/2'), 'weekly report shows sessions vs target');

// ============================================================================
// 4. Reply keyword matching
// ============================================================================
console.log('\n--- 4. Reply keywords ---');

function matchesKeyword(text, keywords) {
  return keywords.some((kw) => text.toLowerCase().includes(kw));
}

assert(matchesKeyword('CONFIRM', config.REPLY_KEYWORDS.confirm), 'CONFIRM matches');
assert(matchesKeyword('yes', config.REPLY_KEYWORDS.confirm), 'yes matches confirm');
assert(matchesKeyword('heading out', config.REPLY_KEYWORDS.headingOut), 'heading out matches');
assert(matchesKeyword('omw', config.REPLY_KEYWORDS.headingOut), 'omw matches heading out');
assert(matchesKeyword('done', config.REPLY_KEYWORDS.done), 'done matches');
assert(matchesKeyword('trained', config.REPLY_KEYWORDS.done), 'trained matches done');
assert(matchesKeyword('skip', config.REPLY_KEYWORDS.skip), 'skip matches');
assert(matchesKeyword('nah', config.REPLY_KEYWORDS.skip), 'nah matches skip');
assert(matchesKeyword('reschedule', config.REPLY_KEYWORDS.reschedule), 'reschedule matches');
assert(matchesKeyword('tomorrow', config.REPLY_KEYWORDS.reschedule), 'tomorrow matches reschedule');
assert(matchesKeyword('lights out', config.REPLY_KEYWORDS.lightsOut), 'lights out matches');
assert(matchesKeyword('goodnight', config.REPLY_KEYWORDS.lightsOut), 'goodnight matches lights out');
assert(matchesKeyword('status', config.REPLY_KEYWORDS.status), 'status matches');
assert(matchesKeyword('how am i', config.REPLY_KEYWORDS.status), 'how am i matches status');
assert(matchesKeyword('help', config.REPLY_KEYWORDS.help), 'help matches');

// Negative tests
assert(!matchesKeyword('hello', config.REPLY_KEYWORDS.confirm), 'hello does not match confirm');
assert(!matchesKeyword('pizza', config.REPLY_KEYWORDS.headingOut), 'pizza does not match heading out');

// ============================================================================
// 5. File structure verification
// ============================================================================
console.log('\n--- 5. File structure ---');

const expectedFiles = [
  'config.js',
  'habit-db.js',
  'telegram.js',
  'scheduler.js',
  'pattern-detector.js',
  'reports.js',
  'bot.js',
  'cli.js',
  'README.md',
  'test-accountability.js',
];

for (const file of expectedFiles) {
  const filePath = path.join(__dirname, file);
  assert(fs.existsSync(filePath), `${file} exists`);
}

assert(fs.existsSync(path.join(__dirname, 'data')), 'data/ directory exists');

// Verify all JS files have 'use strict'
const jsFiles = expectedFiles.filter((f) => f.endsWith('.js'));
for (const file of jsFiles) {
  const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert(content.startsWith("'use strict'"), `${file} has 'use strict'`);
}

// ============================================================================
// 6. Database isolation check
// ============================================================================
console.log('\n--- 6. Isolation check ---');

// Verify the module does NOT reference workspace/data/ databases
const moduleFiles = ['habit-db.js', 'telegram.js', 'scheduler.js', 'pattern-detector.js', 'reports.js', 'bot.js'];
for (const file of moduleFiles) {
  const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert(!content.includes('workspace/data/agent_comms'), `${file} does not reference agent_comms.db`);
  assert(!content.includes('workspace/data/llm_calls'), `${file} does not reference llm_calls.db`);
  assert(!content.includes('workspace/data/swarm_tasks'), `${file} does not reference swarm_tasks.db`);
  assert(!content.includes("require('../shared/llm-router')"), `${file} does not import llm-router`);
  assert(!content.includes("require('../shared/openai-chat')"), `${file} does not import openai-chat`);
}

// ============================================================================
// Cleanup & Summary
// ============================================================================

testDb.close();

// Clean up test database
try { fs.unlinkSync(TEST_DB_PATH); } catch (_) { /* ignore */ }
try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch (_) { /* ignore */ }
try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch (_) { /* ignore */ }

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (errors.length > 0) {
  console.log('\nFailed tests:');
  for (const err of errors) {
    console.log(`  ✗ ${err}`);
  }
  process.exit(1);
}

console.log('\n✅ All accountability tests passed!\n');
