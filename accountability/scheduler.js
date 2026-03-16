'use strict';

/**
 * scheduler.js — Time-based check-in scheduler for the accountability module.
 *
 * Determines what check-ins to send based on current Melbourne time.
 * Called periodically by the bot process (every minute).
 * Idempotent: won't double-send check-ins for the same time slot.
 */

const habitDb = require('./habit-db');
const telegram = require('./telegram');
const patternDetector = require('./pattern-detector');
const { CHECKIN_TIMES, TIMEZONE, PHASES, RECOMMENDED_SLOTS } = require('./config');

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Run scheduled check-ins for the current time.
 * Should be called every ~60 seconds by the bot loop.
 */
async function runScheduledCheckins() {
  const now = _getMelbourneTime();
  const today = now.toISOString().split('T')[0];
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayName = DAY_NAMES[now.getDay()];

  const results = [];

  // ── Bedtime Nudge (9:30 PM) ──────────────────────────────────────────────
  if (_isTimeMatch(hour, minute, CHECKIN_TIMES.bedtimeNudge)) {
    const sent = await _sendIfNotSent('bedtime_nudge', today, async () => {
      const tomorrowDay = DAY_NAMES[(now.getDay() + 1) % 7];
      const tomorrowSessions = _getRecommendedForDay(tomorrowDay);
      const session = tomorrowSessions.length > 0 ? tomorrowSessions[0] : null;

      habitDb.logSleepNudge(today);
      await telegram.sendMessageWithKeyboard(
        telegram.TEMPLATES.bedtimeNudge(session),
        [['💤 LIGHTS OUT'], ['⏰ 15 more min']]
      );
    });
    if (sent) results.push('bedtime_nudge');
  }

  // ── Bedtime Escalation (10:30 PM) ────────────────────────────────────────
  if (_isTimeMatch(hour, minute, CHECKIN_TIMES.bedtimeEscalation)) {
    // Only send if the nudge was sent but not replied to
    const nudge = habitDb.getLastCheckIn('bedtime_nudge');
    if (nudge && nudge.date === today && nudge.status === 'sent') {
      const sent = await _sendIfNotSent('bedtime_escalation', today, async () => {
        await telegram.sendMessage(telegram.TEMPLATES.bedtimeEscalation());
      });
      if (sent) results.push('bedtime_escalation');
    }
  }

  // ── Morning Plan (7:00 AM) ───────────────────────────────────────────────
  if (_isTimeMatch(hour, minute, CHECKIN_TIMES.morningPlan)) {
    const sent = await _sendIfNotSent('morning_plan', today, async () => {
      // Get today's planned sessions or recommended slots
      let sessions = habitDb.getTodayPlannedSession(today, dayName);
      if (sessions.length === 0) {
        sessions = _getRecommendedForDay(dayName);
      }

      const sessionStreak = habitDb.getStreak('sessions');

      if (sessions.length > 0) {
        await telegram.sendMessageWithKeyboard(
          telegram.TEMPLATES.morningPlan(sessions, sessionStreak),
          [['✅ CONFIRM'], ['⏭ SKIP TODAY'], ['📅 RESCHEDULE']]
        );

        // Auto-plan sessions if not already planned
        const weekStart = _getWeekStart();
        const existing = habitDb.getPlannedSessionsForWeek(weekStart);
        const alreadyPlanned = existing.some((p) => p.day === dayName);
        if (!alreadyPlanned && sessions.length > 0) {
          for (const s of sessions) {
            habitDb.planSession({
              weekStart,
              day: dayName,
              sessionType: s.session_type || 'boxing',
              className: s.class_name || s.class || null,
              startTime: s.start_time || s.start || null,
            });
          }
        }
      } else {
        await telegram.sendMessage(
          telegram.TEMPLATES.morningPlan([], sessionStreak)
        );
      }
    });
    if (sent) results.push('morning_plan');
  }

  // ── Pre-Session (4:30 PM, weekdays only) ─────────────────────────────────
  if (_isTimeMatch(hour, minute, CHECKIN_TIMES.preSession) && _isWeekday(dayName)) {
    const todaySessions = habitDb.getTodayPlannedSession(today, dayName);
    const confirmedSession = todaySessions.find((s) => s.status === 'confirmed');

    if (confirmedSession) {
      const sent = await _sendIfNotSent('pre_session', today, async () => {
        await telegram.sendMessageWithKeyboard(
          telegram.TEMPLATES.preSession(confirmedSession),
          [['🏃 HEADING OUT'], ['⏭ SKIPPING'], ['📅 RESCHEDULE']]
        );
      });
      if (sent) results.push('pre_session');
    }
  }

  // ── Pre-Session Follow-Up (5:30 PM) ──────────────────────────────────────
  if (_isTimeMatch(hour, minute, CHECKIN_TIMES.preSessionFollowUp) && _isWeekday(dayName)) {
    const preSession = habitDb.getLastCheckIn('pre_session');
    if (preSession && preSession.date === today && preSession.status === 'sent') {
      const sent = await _sendIfNotSent('pre_session_followup', today, async () => {
        await telegram.sendMessageWithKeyboard(
          telegram.TEMPLATES.preSessionFollowUp(),
          [['🏃 GOING'], ['⏭ SKIPPING'], ['📅 RESCHEDULE']]
        );
      });
      if (sent) results.push('pre_session_followup');
    }
  }

  // ── Weekly Report (Sunday 10 AM) ─────────────────────────────────────────
  if (dayName === CHECKIN_TIMES.weeklyReport.day &&
      _isTimeMatch(hour, minute, CHECKIN_TIMES.weeklyReport)) {
    const sent = await _sendIfNotSent('weekly_report', today, async () => {
      const weekStart = _getWeekStart();
      const stats = habitDb.getWeeklyStats(weekStart);
      await telegram.sendMessage(telegram.TEMPLATES.weeklyReport(stats));

      // Run pattern detection alongside weekly report
      const patterns = patternDetector.detectPatterns();
      for (const pattern of patterns) {
        await telegram.sendMessage(telegram.TEMPLATES.patternAlert(pattern.type));
      }
    });
    if (sent) results.push('weekly_report');
  }

  // ── Pattern Detection (runs at noon daily) ───────────────────────────────
  if (hour === 12 && minute >= 0 && minute < 2) {
    const patterns = patternDetector.detectPatterns();
    for (const pattern of patterns) {
      await telegram.sendMessage(telegram.TEMPLATES.patternAlert(pattern.type));
      results.push(`pattern_${pattern.type}`);
    }
  }

  return results;
}

// ── Send Helpers ─────────────────────────────────────────────────────────────

/**
 * Send a check-in only if one hasn't already been sent today for this type.
 * Returns true if sent, false if skipped.
 */
async function _sendIfNotSent(type, date, sendFn) {
  const last = habitDb.getLastCheckIn(type);
  if (last && last.date === date) {
    return false; // already sent today
  }

  try {
    await sendFn();
    habitDb.logCheckIn({
      type,
      date,
      sentAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.error(`[accountability/scheduler] Failed to send ${type}: ${err.message}`);
    return false;
  }
}

// ── Reply Processing ─────────────────────────────────────────────────────────

const { REPLY_KEYWORDS } = require('./config');

/**
 * Process an incoming reply from the user.
 * Matches against known keywords and takes appropriate action.
 */
async function processReply(text) {
  const lower = text.toLowerCase().trim();
  const today = new Date().toISOString().split('T')[0];
  const dayName = DAY_NAMES[new Date().getDay()];

  // ── CONFIRM ────────────────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.confirm)) {
    const sessions = habitDb.getTodayPlannedSession(today, dayName);
    for (const s of sessions) {
      if (s.status === 'planned') {
        habitDb.updatePlannedSession(s.id, 'confirmed');
      }
    }
    _markLatestCheckInReplied(text);
    await telegram.removeKeyboard('✅ *Locked in.* I\'ll check in at 4:30 PM before your session.');
    return 'confirmed';
  }

  // ── HEADING OUT / GOING ────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.headingOut)) {
    _markLatestCheckInReplied(text);
    await telegram.removeKeyboard('🏃 *Let\'s go!* Smash it, Jeff. Reply *DONE* when you finish.');
    return 'heading_out';
  }

  // ── DONE / TRAINED ─────────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.done)) {
    // Log the session
    const sessions = habitDb.getTodayPlannedSession(today, dayName);
    const confirmedSession = sessions.find((s) => s.status === 'confirmed') || sessions[0];

    habitDb.logSession({
      date: today,
      sessionType: confirmedSession ? confirmedSession.session_type : 'boxing',
      className: confirmedSession ? confirmedSession.class_name : null,
      durationMin: confirmedSession ? _estimateDuration(confirmedSession) : 60,
    });

    // Mark planned session as completed
    if (confirmedSession) {
      habitDb.updatePlannedSession(confirmedSession.id, 'completed');
    }

    const streak = habitDb.getStreak('sessions');
    _markLatestCheckInReplied(text);
    await telegram.removeKeyboard(telegram.TEMPLATES.sessionComplete(streak));
    return 'session_logged';
  }

  // ── SKIP ───────────────────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.skip)) {
    const sessions = habitDb.getTodayPlannedSession(today, dayName);
    for (const s of sessions) {
      habitDb.updatePlannedSession(s.id, 'skipped');
    }
    _markLatestCheckInReplied(text);

    // Check if this triggers a pattern
    const patterns = patternDetector.detectPatterns();
    if (patterns.length > 0) {
      await telegram.sendMessage(telegram.TEMPLATES.patternAlert(patterns[0].type));
    } else {
      await telegram.removeKeyboard('📝 *Noted.* No judgment. Show up tomorrow.');
    }
    return 'skipped';
  }

  // ── RESCHEDULE ─────────────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.reschedule)) {
    const sessions = habitDb.getTodayPlannedSession(today, dayName);
    for (const s of sessions) {
      habitDb.updatePlannedSession(s.id, 'rescheduled');
    }
    _markLatestCheckInReplied(text);
    await telegram.removeKeyboard('📅 *Rescheduled.* Which day works? Lunch class (12-1pm) is always an option.');
    return 'rescheduled';
  }

  // ── LIGHTS OUT ─────────────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.lightsOut)) {
    const now = _getMelbourneTime();
    const isLate = now.getHours() >= 22 && now.getMinutes() >= 30;
    habitDb.logLightsOut(today, isLate);
    habitDb.logSleepReply(today);
    _markLatestCheckInReplied(text);

    if (isLate) {
      await telegram.removeKeyboard('😴 *Better late than never.* Try for 10:30 PM tomorrow. Goodnight, Jeff.');
    } else {
      await telegram.removeKeyboard('😴 *Good call.* On-time bedtime logged. Sleep well, Jeff. 💤');
    }
    return 'lights_out';
  }

  // ── STATUS ─────────────────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.status)) {
    const weekStart = _getWeekStart();
    const stats = habitDb.getWeeklyStats(weekStart);
    await telegram.sendMessage(telegram.TEMPLATES.status(stats));
    return 'status';
  }

  // ── HELP ───────────────────────────────────────────────────────────────
  if (_matchesKeyword(lower, REPLY_KEYWORDS.help)) {
    await telegram.sendMessage(telegram.TEMPLATES.help());
    return 'help';
  }

  // ── Unrecognized ───────────────────────────────────────────────────────
  return null;
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

function _matchesKeyword(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}

function _markLatestCheckInReplied(reply) {
  const pending = habitDb.getPendingCheckIns();
  if (pending.length > 0) {
    habitDb.updateCheckInReply(pending[0].id, reply);
  }
}

function _getRecommendedForDay(dayName) {
  const phase = parseInt(habitDb.getConfig('current_phase') || '1');
  const slots = require('./config').RECOMMENDED_SLOTS[phase];
  if (!slots) return [];

  const sessions = [];
  for (const s of (slots.boxing || [])) {
    if (s.day === dayName) {
      sessions.push({
        session_type: 'boxing',
        class_name: s.class,
        start_time: s.start,
      });
    }
  }
  for (const s of (slots.gym || [])) {
    if (s.day === dayName) {
      sessions.push({
        session_type: 'gym',
        class_name: s.note,
        start_time: null,
      });
    }
  }
  return sessions;
}

function _estimateDuration(session) {
  if (!session.class_name) return 60;
  if (session.class_name.includes('45')) return 45;
  if (session.class_name.includes('60')) return 60;
  return 60;
}

function _isTimeMatch(hour, minute, target) {
  return hour === target.hour && minute >= target.minute && minute < target.minute + 2;
}

function _isWeekday(dayName) {
  return ['mon', 'tue', 'wed', 'thu', 'fri'].includes(dayName);
}

function _getMelbourneTime() {
  // Use Intl API to get Melbourne time accurately
  const now = new Date();
  const melbStr = now.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' });
  // Parse the AU locale string back to extract hours/minutes
  const parts = melbStr.split(', ');
  const dateParts = parts[0].split('/');
  const timeParts = parts[1].split(':');

  const melbDate = new Date();
  melbDate.setHours(parseInt(timeParts[0]));
  melbDate.setMinutes(parseInt(timeParts[1]));
  return melbDate;
}

function _getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().split('T')[0];
}

module.exports = {
  runScheduledCheckins,
  processReply,
};
