'use strict';

/**
 * reports.js — Weekly and trainer report generation.
 *
 * Generates formatted summaries for:
 * 1. Weekly Telegram report (Sunday mornings)
 * 2. Fortnightly trainer summary (before trainer sessions)
 */

const habitDb = require('./habit-db');
const { PHASES } = require('./config');

/**
 * Generate a weekly stats summary for the given week.
 * Returns raw stats object (formatting is in telegram.js TEMPLATES).
 */
function generateWeeklyStats(weekStart) {
  if (!weekStart) {
    weekStart = _getWeekStart();
  }
  return habitDb.getWeeklyStats(weekStart);
}

/**
 * Generate a fortnightly trainer report.
 * Covers the last 2 weeks of activity for the gym trainer.
 */
function generateTrainerReport() {
  const thisWeekStart = _getWeekStart();
  const lastWeekStart = _addDays(thisWeekStart, -7);

  const thisWeek = habitDb.getWeeklyStats(thisWeekStart);
  const lastWeek = habitDb.getWeeklyStats(lastWeekStart);

  const phase = parseInt(habitDb.getConfig('current_phase') || '1');
  const phaseInfo = PHASES[phase];

  // Get all sessions in the 2-week period
  const allSessions = habitDb.getSessionsInRange(lastWeekStart, _addDays(thisWeekStart, 6));

  // Get sleep data
  const sleepLogs = habitDb.getRecentSleepLogs(14);
  const lateBedtimes = sleepLogs.filter((s) => s.is_late).length;
  const onTimeBedtimes = sleepLogs.filter((s) => s.lights_out_at && !s.is_late).length;

  // Get pattern events
  const patterns = habitDb.getRecentPatternEvents(14);

  const report = {
    period: `${lastWeekStart} to ${_addDays(thisWeekStart, 6)}`,
    phase: { number: phase, name: phaseInfo.name, target: phaseInfo.weeklyTarget },
    weeks: {
      last: {
        start: lastWeekStart,
        sessions: lastWeek.sessions,
        planned: lastWeek.planned,
      },
      current: {
        start: thisWeekStart,
        sessions: thisWeek.sessions,
        planned: thisWeek.planned,
      },
    },
    totalSessions: allSessions.length,
    sessionDetails: allSessions.map((s) => ({
      date: s.date,
      type: s.session_type,
      class: s.class_name,
      duration: s.duration_min,
      notes: s.notes,
    })),
    sleep: {
      tracked: sleepLogs.length,
      onTime: onTimeBedtimes,
      late: lateBedtimes,
    },
    patterns: patterns.map((p) => ({
      type: p.pattern_type,
      details: p.details,
      date: p.triggered_at,
    })),
    streaks: {
      sessions: habitDb.getStreak('sessions'),
      bedtime: habitDb.getStreak('bedtime'),
    },
  };

  return report;
}

/**
 * Format the trainer report as a readable Telegram message.
 */
function formatTrainerReport(report) {
  const lines = [
    '📋 *Trainer Report*',
    `Period: ${report.period}`,
    `Phase ${report.phase.number}: ${report.phase.name}`,
    '',
    '*Last 2 weeks:*',
    `  Week 1: ${report.weeks.last.sessions.total} sessions (${report.weeks.last.sessions.boxing} boxing, ${report.weeks.last.sessions.gym} gym)`,
    `  Week 2: ${report.weeks.current.sessions.total} sessions (${report.weeks.current.sessions.boxing} boxing, ${report.weeks.current.sessions.gym} gym)`,
    '',
    '*Session details:*',
  ];

  if (report.sessionDetails.length === 0) {
    lines.push('  No sessions logged.');
  } else {
    for (const s of report.sessionDetails) {
      let detail = `  • ${s.date} — ${s.type}`;
      if (s.class) detail += ` (${s.class})`;
      if (s.duration) detail += ` — ${s.duration}min`;
      if (s.notes) detail += ` — ${s.notes}`;
      lines.push(detail);
    }
  }

  lines.push('');
  lines.push('*Sleep:*');
  lines.push(`  On-time: ${report.sleep.onTime} | Late: ${report.sleep.late} | Tracked: ${report.sleep.tracked} nights`);

  if (report.patterns.length > 0) {
    lines.push('');
    lines.push('*⚠️ Patterns detected:*');
    for (const p of report.patterns) {
      lines.push(`  • ${p.type}: ${p.details}`);
    }
  }

  lines.push('');
  lines.push(`🔥 Session streak: ${report.streaks.sessions.current} weeks`);
  lines.push(`😴 Bedtime streak: ${report.streaks.bedtime.current} days`);

  return lines.join('\n');
}

/**
 * Check if the user should be prompted to advance to the next phase.
 * Criteria: completed at least 3 of the last 4 weeks at target.
 */
function shouldAdvancePhase() {
  const phase = parseInt(habitDb.getConfig('current_phase') || '1');
  if (phase >= 3) return false; // already at max

  const phaseInfo = PHASES[phase];
  const target = phaseInfo.weeklyTarget.total;

  let weeksAtTarget = 0;
  const thisWeekStart = _getWeekStart();

  for (let i = 0; i < 4; i++) {
    const weekStart = _addDays(thisWeekStart, -(i * 7));
    const count = habitDb.getSessionCountThisWeek(weekStart);
    if (count.total >= target) {
      weeksAtTarget++;
    }
  }

  return weeksAtTarget >= 3;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().split('T')[0];
}

function _addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

module.exports = {
  generateWeeklyStats,
  generateTrainerReport,
  formatTrainerReport,
  shouldAdvancePhase,
};
