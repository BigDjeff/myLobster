'use strict';

/**
 * config.js — Accountability module configuration.
 *
 * Boxing gym schedule, phase targets, check-in timing, and constants.
 * All times are in Australia/Melbourne timezone.
 */

const TIMEZONE = 'Australia/Melbourne';

// ── Boxing Gym Timetable ─────────────────────────────────────────────────────
// Parsed from gym schedule image. Each entry: { day, time, duration, class }
const BOXING_SCHEDULE = [
  // Morning classes
  { day: 'mon', start: '05:30', end: '06:15', class: 'Bag + 45', type: 'bag' },
  { day: 'mon', start: '06:15', end: '07:00', class: 'Padwork + 45', type: 'padwork' },
  { day: 'tue', start: '05:30', end: '06:15', class: 'Padwork + 45', type: 'padwork' },
  { day: 'tue', start: '06:15', end: '07:00', class: 'Bag + 45', type: 'bag' },
  { day: 'wed', start: '05:30', end: '06:15', class: 'Bag + 45', type: 'bag' },
  { day: 'wed', start: '06:15', end: '07:00', class: 'Padwork + 45', type: 'padwork' },
  { day: 'thu', start: '05:30', end: '06:15', class: 'Padwork + 45', type: 'padwork' },
  { day: 'thu', start: '06:15', end: '07:00', class: 'Bag + 45', type: 'bag' },
  { day: 'fri', start: '05:30', end: '06:15', class: 'Bag + 45', type: 'bag' },
  { day: 'fri', start: '06:15', end: '07:00', class: 'Padwork + 45', type: 'padwork' },
  { day: 'sat', start: '07:00', end: '07:45', class: 'Bag + 45', type: 'bag' },
  { day: 'sat', start: '08:00', end: '09:00', class: 'Padwork + 60', type: 'padwork' },

  // Lunch classes
  { day: 'mon', start: '12:00', end: '13:00', class: 'Boxing Skills & Drills', type: 'skills' },
  { day: 'tue', start: '12:00', end: '13:00', class: 'Boxing Skills & Drills', type: 'skills' },
  { day: 'wed', start: '12:00', end: '13:00', class: 'Boxing Skills & Drills', type: 'skills' },
  { day: 'thu', start: '12:00', end: '13:00', class: 'Boxing Skills & Drills', type: 'skills' },
  { day: 'fri', start: '12:00', end: '13:00', class: 'Boxing Skills & Drills', type: 'skills' },

  // After-work classes
  { day: 'mon', start: '17:00', end: '17:45', class: 'Bag + 45', type: 'bag' },
  { day: 'tue', start: '17:00', end: '17:45', class: 'Bag + 45', type: 'bag' },
  { day: 'tue', start: '17:00', end: '17:45', class: 'Padwork + 45', type: 'padwork' },
  { day: 'wed', start: '17:00', end: '17:45', class: 'Bag + 45', type: 'bag' },
  { day: 'thu', start: '17:00', end: '17:45', class: 'Bag + 45', type: 'bag' },
  { day: 'thu', start: '17:00', end: '17:45', class: 'Padwork + 45', type: 'padwork' },
  { day: 'fri', start: '17:00', end: '17:45', class: 'Bag + 45', type: 'bag' },

  { day: 'mon', start: '18:00', end: '19:00', class: 'Boxing Basics', type: 'basics' },
  { day: 'tue', start: '18:00', end: '19:00', class: 'Boxing Basics', type: 'basics' },
  { day: 'wed', start: '18:00', end: '19:00', class: 'Boxing Basics', type: 'basics' },
  { day: 'thu', start: '18:00', end: '19:00', class: 'Boxing Basics', type: 'basics' },

  { day: 'mon', start: '18:00', end: '19:00', class: 'Sparring / Drills', type: 'sparring' },
  { day: 'tue', start: '18:00', end: '19:00', class: 'Boxing Skills & Drills', type: 'skills' },
  { day: 'wed', start: '18:00', end: '19:00', class: 'Sparring / Drills', type: 'sparring' },
  { day: 'thu', start: '18:00', end: '19:00', class: 'Boxing Skills & Drills', type: 'skills' },
  { day: 'fri', start: '18:00', end: '19:00', class: 'Sparring / Drills', type: 'sparring' },

  { day: 'mon', start: '18:00', end: '19:00', class: 'Padwork + 60', type: 'padwork' },
  { day: 'wed', start: '18:00', end: '19:00', class: 'Padwork + 60', type: 'padwork' },

  { day: 'mon', start: '19:00', end: '19:45', class: 'Padwork + 45', type: 'padwork' },
  { day: 'tue', start: '19:00', end: '19:45', class: 'Bag + 45', type: 'bag' },
  { day: 'wed', start: '19:00', end: '19:45', class: 'Padwork + 45', type: 'padwork' },
  { day: 'thu', start: '19:00', end: '19:45', class: 'Bag + 45', type: 'bag' },
];

// ── Phase Definitions ────────────────────────────────────────────────────────
// Gradual ramp-up to prevent burnout. Each phase lasts ~4 weeks.
const PHASES = {
  1: {
    name: 'Foundation',
    weeklyTarget: { boxing: 1, gym: 1, total: 2 },
    description: 'Build the habit. 1 boxing + 1 gym per week.',
    durationWeeks: 4,
  },
  2: {
    name: 'Building',
    weeklyTarget: { boxing: 2, gym: 1, total: 3 },
    description: 'Add a second boxing session. 2 boxing + 1 gym.',
    durationWeeks: 4,
  },
  3: {
    name: 'Sustainable',
    weeklyTarget: { boxing: 2, gym: 2, total: 4 },
    description: 'Full routine. 2 boxing + 2 gym (includes trainer).',
    durationWeeks: 0, // ongoing
  },
};

// ── Recommended Sessions ─────────────────────────────────────────────────────
// Default slots for each phase (user can override via CLI or bot reply)
const RECOMMENDED_SLOTS = {
  1: {
    boxing: [
      { day: 'tue', start: '18:00', class: 'Boxing Basics' },
    ],
    gym: [
      { day: 'thu', note: 'Gym session (trainer fortnight)' },
    ],
  },
  2: {
    boxing: [
      { day: 'tue', start: '18:00', class: 'Boxing Basics' },
      { day: 'thu', start: '18:00', class: 'Boxing Basics' },
    ],
    gym: [
      { day: 'sat', note: 'Gym session (trainer fortnight)' },
    ],
  },
  3: {
    boxing: [
      { day: 'tue', start: '18:00', class: 'Boxing Basics' },
      { day: 'thu', start: '18:00', class: 'Boxing Skills & Drills' },
    ],
    gym: [
      { day: 'mon', note: 'Gym session' },
      { day: 'sat', note: 'Gym session (trainer fortnight)' },
    ],
  },
};

// ── Check-in Timing (hours in 24h format, Melbourne time) ────────────────────
const CHECKIN_TIMES = {
  bedtimeNudge: { hour: 21, minute: 30 },      // 9:30 PM — wind down
  bedtimeEscalation: { hour: 22, minute: 30 },  // 10:30 PM — you're up late
  morningPlan: { hour: 7, minute: 0 },           // 7:00 AM — today's plan
  preSession: { hour: 16, minute: 30 },          // 4:30 PM — intercept danger zone
  preSessionFollowUp: { hour: 17, minute: 30 },  // 5:30 PM — missed check-in?
  weeklyReport: { day: 'sun', hour: 10, minute: 0 }, // Sunday 10 AM
};

// ── Pattern Detection Thresholds ─────────────────────────────────────────────
const PATTERN_THRESHOLDS = {
  consecutiveSkips: 2,        // trigger intervention after 2 skips in a row
  lateBedtimesPerWeek: 3,     // trigger if 3+ late bedtimes in a week
  bedtimeCutoff: '22:30',     // anything after this is "late"
  streakBonusAt: 7,           // celebrate at 7-day streak
};

// ── Bot Reply Keywords ───────────────────────────────────────────────────────
const REPLY_KEYWORDS = {
  confirm: ['confirm', 'yes', 'y', 'locked', 'lock'],
  skip: ['skip', 'skipping', 'no', 'n', 'cant', "can't", 'nah'],
  reschedule: ['reschedule', 'tomorrow', 'later', 'move'],
  headingOut: ['heading out', 'heading', 'leaving', 'on my way', 'omw', 'going'],
  done: ['done', 'trained', 'finished', 'completed', 'went'],
  lightsOut: ['lights out', 'sleep', 'sleeping', 'bed', 'goodnight'],
  status: ['status', 'streak', 'progress', 'how am i'],
  help: ['help', 'commands', 'menu'],
};

// ── Telegram Config ──────────────────────────────────────────────────────────
const TELEGRAM = {
  configPath: '/Users/jeffcheng/.openclaw/openclaw.json',
  chatId: '5014458510',
  pollingIntervalMs: 3000,
  maxMessageLength: 4000,
};

module.exports = {
  TIMEZONE,
  BOXING_SCHEDULE,
  PHASES,
  RECOMMENDED_SLOTS,
  CHECKIN_TIMES,
  PATTERN_THRESHOLDS,
  REPLY_KEYWORDS,
  TELEGRAM,
};
