'use strict';

/**
 * pattern-detector.js — Detects negative habit patterns and triggers interventions.
 *
 * Monitors:
 * 1. Consecutive session skips
 * 2. Late bedtimes accumulating in a week
 * 3. Declining session trend over multiple weeks
 *
 * When a pattern is detected, logs it and returns an intervention recommendation.
 */

const habitDb = require('./habit-db');
const { PATTERN_THRESHOLDS } = require('./config');

/**
 * Run all pattern checks. Returns an array of triggered patterns.
 * Each pattern: { type, details, intervention, alreadyTriggered }
 */
function detectPatterns() {
  const triggered = [];

  const skipResult = _checkConsecutiveSkips();
  if (skipResult) triggered.push(skipResult);

  const bedtimeResult = _checkLateBedtimes();
  if (bedtimeResult) triggered.push(bedtimeResult);

  const trendResult = _checkDecliningTrend();
  if (trendResult) triggered.push(trendResult);

  return triggered;
}

/**
 * Check for consecutive session skips.
 */
function _checkConsecutiveSkips() {
  const skips = habitDb.getConsecutiveSkips();
  if (skips < PATTERN_THRESHOLDS.consecutiveSkips) return null;

  // Check if we already triggered this recently (within 2 days)
  const recent = habitDb.getRecentPatternEvents(2);
  const alreadyTriggered = recent.some((e) => e.pattern_type === 'consecutive_skips');

  if (alreadyTriggered) return null;

  const details = `${skips} consecutive sessions skipped`;
  const intervention = 'Suggest lighter session (Bag+45 at 5pm) instead of full skip';

  habitDb.logPatternEvent({
    patternType: 'consecutive_skips',
    details,
    intervention,
  });

  return {
    type: 'consecutive_skips',
    details,
    intervention,
    severity: skips >= 3 ? 'high' : 'medium',
  };
}

/**
 * Check for too many late bedtimes in the current week.
 */
function _checkLateBedtimes() {
  const weekStart = _getWeekStart();
  const lateBedtimes = habitDb.getLateBedtimesThisWeek(weekStart);

  if (lateBedtimes < PATTERN_THRESHOLDS.lateBedtimesPerWeek) return null;

  // Check if already triggered this week
  const recent = habitDb.getRecentPatternEvents(7);
  const alreadyTriggered = recent.some((e) =>
    e.pattern_type === 'late_bedtimes' &&
    e.triggered_at >= weekStart
  );

  if (alreadyTriggered) return null;

  const details = `${lateBedtimes} late bedtimes this week (threshold: ${PATTERN_THRESHOLDS.lateBedtimesPerWeek})`;
  const intervention = 'Sleep is the keystone — emphasize bedtime compliance';

  habitDb.logPatternEvent({
    patternType: 'late_bedtimes',
    details,
    intervention,
  });

  return {
    type: 'late_bedtimes',
    details,
    intervention,
    severity: lateBedtimes >= 5 ? 'high' : 'medium',
  };
}

/**
 * Check for declining session trend over the past 3 weeks.
 * If each week has fewer sessions than the previous, that's a decline.
 */
function _checkDecliningTrend() {
  const today = new Date().toISOString().split('T')[0];
  const weeks = [];

  for (let i = 0; i < 3; i++) {
    const weekStart = _addDays(_getWeekStart(), -(i * 7));
    const count = habitDb.getSessionCountThisWeek(weekStart);
    weeks.push({ weekStart, total: count.total });
  }

  // Need at least 3 weeks of data
  if (weeks.some((w) => w.total === 0 && weeks.indexOf(w) === 2)) return null;

  // Check for strictly declining: week -2 > week -1 > this week
  const [current, lastWeek, twoWeeksAgo] = weeks;
  if (twoWeeksAgo.total > lastWeek.total && lastWeek.total > current.total) {
    // Check if already triggered this week
    const recent = habitDb.getRecentPatternEvents(7);
    const alreadyTriggered = recent.some((e) => e.pattern_type === 'declining_trend');
    if (alreadyTriggered) return null;

    const details = `Declining: ${twoWeeksAgo.total} → ${lastWeek.total} → ${current.total} sessions over 3 weeks`;
    const intervention = 'Downgrade to easier sessions rather than stopping entirely';

    habitDb.logPatternEvent({
      patternType: 'declining_trend',
      details,
      intervention,
    });

    return {
      type: 'declining_trend',
      details,
      intervention,
      severity: 'high',
    };
  }

  return null;
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
  detectPatterns,
};
