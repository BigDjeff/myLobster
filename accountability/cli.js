'use strict';

/**
 * cli.js — Manual CLI for testing the accountability module.
 *
 * Usage:
 *   node accountability/cli.js log-session boxing "Boxing Basics" 60
 *   node accountability/cli.js log-session gym "Trainer session" 45 "Felt strong"
 *   node accountability/cli.js log-sleep [on-time|late]
 *   node accountability/cli.js status
 *   node accountability/cli.js weekly-report
 *   node accountability/cli.js trainer-report
 *   node accountability/cli.js phase [1|2|3]
 *   node accountability/cli.js plan-week
 *   node accountability/cli.js send-test
 *   node accountability/cli.js detect-patterns
 *   node accountability/cli.js reset-db
 */

const habitDb = require('./habit-db');
const telegram = require('./telegram');
const reports = require('./reports');
const patternDetector = require('./pattern-detector');
const { PHASES, RECOMMENDED_SLOTS } = require('./config');

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  // Initialize db
  habitDb.getDb();

  switch (command) {
    case 'log-session': {
      const sessionType = args[0]; // boxing | gym
      const className = args[1] || null;
      const durationMin = parseInt(args[2]) || 60;
      const notes = args[3] || null;
      const today = new Date().toISOString().split('T')[0];

      if (!sessionType || !['boxing', 'gym'].includes(sessionType)) {
        console.log('Usage: log-session <boxing|gym> [class] [duration] [notes]');
        break;
      }

      const id = habitDb.logSession({ date: today, sessionType, className, durationMin, notes });
      console.log(`✅ Session logged (ID: ${id})`);
      console.log(`   Type: ${sessionType}`);
      console.log(`   Class: ${className || 'N/A'}`);
      console.log(`   Duration: ${durationMin} min`);
      if (notes) console.log(`   Notes: ${notes}`);

      const streak = habitDb.getStreak('sessions');
      console.log(`\n🔥 Session streak: ${streak.current} weeks (best: ${streak.best})`);
      break;
    }

    case 'log-sleep': {
      const status = args[0] || 'on-time'; // on-time | late
      const today = new Date().toISOString().split('T')[0];
      const isLate = status === 'late';

      habitDb.logLightsOut(today, isLate);
      console.log(`😴 Sleep logged: ${isLate ? 'LATE' : 'ON TIME'}`);

      const streak = habitDb.getStreak('bedtime');
      console.log(`   Bedtime streak: ${streak.current} days (best: ${streak.best})`);
      break;
    }

    case 'status': {
      const phase = parseInt(habitDb.getConfig('current_phase') || '1');
      const phaseInfo = PHASES[phase];
      const weekStart = _getWeekStart();
      const stats = habitDb.getWeeklyStats(weekStart);

      console.log(`\n📋 Accountability Status`);
      console.log(`   Phase ${phase}: ${phaseInfo.name}`);
      console.log(`   Target: ${phaseInfo.weeklyTarget.total} sessions/week (${phaseInfo.weeklyTarget.boxing} boxing + ${phaseInfo.weeklyTarget.gym} gym)`);
      console.log(`\n   This week (${weekStart}):`);
      console.log(`   Sessions: ${stats.sessions.total}/${phaseInfo.weeklyTarget.total}`);
      console.log(`     Boxing: ${stats.sessions.boxing}/${phaseInfo.weeklyTarget.boxing}`);
      console.log(`     Gym: ${stats.sessions.gym}/${phaseInfo.weeklyTarget.gym}`);
      console.log(`   Late bedtimes: ${stats.lateBedtimes}`);
      console.log(`\n   Streaks:`);
      console.log(`   🔥 Sessions: ${stats.streaks.sessions.current} weeks (best: ${stats.streaks.sessions.best})`);
      console.log(`   😴 Bedtime: ${stats.streaks.bedtime.current} days (best: ${stats.streaks.bedtime.best})`);
      console.log(`\n   Check-ins: ${stats.checkIns.replied}/${stats.checkIns.total} replied`);
      break;
    }

    case 'weekly-report': {
      const weekStart = _getWeekStart();
      const stats = reports.generateWeeklyStats(weekStart);
      console.log(telegram.TEMPLATES.weeklyReport(stats));
      break;
    }

    case 'trainer-report': {
      const report = reports.generateTrainerReport();
      console.log(reports.formatTrainerReport(report));
      break;
    }

    case 'phase': {
      const newPhase = parseInt(args[0]);
      if (!newPhase || newPhase < 1 || newPhase > 3) {
        const current = habitDb.getConfig('current_phase');
        console.log(`Current phase: ${current}`);
        console.log('Usage: phase <1|2|3>');
        break;
      }
      habitDb.setConfig('current_phase', String(newPhase));
      habitDb.setConfig('phase_start_date', new Date().toISOString().split('T')[0]);
      const phaseInfo = PHASES[newPhase];
      console.log(`✅ Phase updated to ${newPhase}: ${phaseInfo.name}`);
      console.log(`   ${phaseInfo.description}`);
      break;
    }

    case 'plan-week': {
      const weekStart = _getWeekStart();
      const phase = parseInt(habitDb.getConfig('current_phase') || '1');
      const slots = RECOMMENDED_SLOTS[phase];

      console.log(`\n📅 Planning week of ${weekStart} (Phase ${phase})`);

      for (const s of (slots.boxing || [])) {
        const id = habitDb.planSession({
          weekStart,
          day: s.day,
          sessionType: 'boxing',
          className: s.class,
          startTime: s.start,
        });
        console.log(`   Planned: ${s.day} — ${s.class} at ${s.start} (ID: ${id})`);
      }
      for (const s of (slots.gym || [])) {
        const id = habitDb.planSession({
          weekStart,
          day: s.day,
          sessionType: 'gym',
          className: s.note,
        });
        console.log(`   Planned: ${s.day} — ${s.note} (ID: ${id})`);
      }

      console.log('\n✅ Week planned. Sessions will show in morning check-ins.');
      break;
    }

    case 'send-test': {
      console.log('Sending test message to Telegram...');
      try {
        await telegram.sendMessage('🧪 *Accountability bot test message.*\n\nIf you see this, the bot is working!');
        console.log('✅ Test message sent!');
      } catch (err) {
        console.error(`❌ Failed: ${err.message}`);
      }
      break;
    }

    case 'detect-patterns': {
      const patterns = patternDetector.detectPatterns();
      if (patterns.length === 0) {
        console.log('✅ No negative patterns detected.');
      } else {
        for (const p of patterns) {
          console.log(`⚠️ ${p.type} (${p.severity}): ${p.details}`);
          console.log(`   Intervention: ${p.intervention}`);
        }
      }
      break;
    }

    case 'reset-db': {
      const dbPath = require('path').join(__dirname, 'data', 'habits.db');
      habitDb.closeDb();
      try {
        require('fs').unlinkSync(dbPath);
        console.log('✅ Database reset. A fresh one will be created on next run.');
      } catch (err) {
        console.error(`❌ Failed to delete database: ${err.message}`);
      }
      break;
    }

    default:
      console.log(`
Accountability CLI — Manual testing interface

Usage: node accountability/cli.js <command> [args]

Commands:
  log-session <boxing|gym> [class] [duration] [notes]
                           Log a completed session
  log-sleep [on-time|late] Log bedtime
  status                   Show current status and streaks
  weekly-report            Generate weekly report
  trainer-report           Generate fortnightly trainer report
  phase [1|2|3]            View or set current phase
  plan-week                Auto-plan this week's sessions
  send-test                Send a test Telegram message
  detect-patterns          Run pattern detection
  reset-db                 Delete and recreate the database

Examples:
  node accountability/cli.js log-session boxing "Boxing Basics" 60
  node accountability/cli.js log-sleep on-time
  node accountability/cli.js status
`);
  }

  habitDb.closeDb();
}

function _getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().split('T')[0];
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  habitDb.closeDb();
  process.exit(1);
});
