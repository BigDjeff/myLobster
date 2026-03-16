'use strict';

/**
 * telegram.js — Telegram Bot API wrapper for the accountability module.
 *
 * Reads bot token from ~/.openclaw/openclaw.json (same source as existing scripts).
 * Uses Node's built-in https module — no new dependencies.
 * Supports sending messages and long-polling for replies.
 */

const https = require('https');
const fs = require('fs');
const { TELEGRAM } = require('./config');

let _botToken = null;

// ── Token Resolution ─────────────────────────────────────────────────────────

function getBotToken() {
  if (_botToken) return _botToken;
  try {
    const raw = fs.readFileSync(TELEGRAM.configPath, 'utf8');
    const config = JSON.parse(raw);
    _botToken = config.channels.telegram.botToken;
    if (!_botToken) throw new Error('botToken is empty');
    return _botToken;
  } catch (err) {
    throw new Error(`Failed to read Telegram bot token from ${TELEGRAM.configPath}: ${err.message}`);
  }
}

// ── HTTP Helper ──────────────────────────────────────────────────────────────

function _apiCall(method, params) {
  return new Promise((resolve, reject) => {
    const token = getBotToken();
    const postData = JSON.stringify(params || {});

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            resolve(parsed.result);
          } else {
            reject(new Error(`Telegram API error: ${parsed.description || 'unknown'}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Telegram response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Telegram API request timed out'));
    });
    req.write(postData);
    req.end();
  });
}

// ── Send Messages ────────────────────────────────────────────────────────────

async function sendMessage(text, options = {}) {
  const chatId = options.chatId || TELEGRAM.chatId;
  const truncated = text.length > TELEGRAM.maxMessageLength
    ? text.substring(0, TELEGRAM.maxMessageLength - 3) + '...'
    : text;

  return _apiCall('sendMessage', {
    chat_id: chatId,
    text: truncated,
    parse_mode: options.parseMode || 'Markdown',
    disable_notification: options.silent || false,
  });
}

async function sendMessageWithKeyboard(text, buttons, options = {}) {
  const chatId = options.chatId || TELEGRAM.chatId;
  const keyboard = buttons.map((row) =>
    Array.isArray(row) ? row.map((btn) => ({ text: btn })) : [{ text: row }]
  );

  return _apiCall('sendMessage', {
    chat_id: chatId,
    text: text,
    parse_mode: options.parseMode || 'Markdown',
    reply_markup: {
      keyboard: keyboard,
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function removeKeyboard(text) {
  return _apiCall('sendMessage', {
    chat_id: TELEGRAM.chatId,
    text: text,
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true },
  });
}

// ── Receive Messages (Long Polling) ──────────────────────────────────────────

async function getUpdates(offset, timeout) {
  const params = {
    timeout: timeout || 10,
    allowed_updates: ['message'],
  };
  if (offset) {
    params.offset = offset;
  }
  return _apiCall('getUpdates', params);
}

/**
 * Poll for new messages from the user.
 * Returns an array of { text, date, messageId } for messages from the target chat.
 */
async function pollMessages(lastUpdateId) {
  try {
    const updates = await getUpdates(lastUpdateId + 1, 5);
    const messages = [];
    let newLastId = lastUpdateId;

    for (const update of updates) {
      if (update.update_id > newLastId) {
        newLastId = update.update_id;
      }
      if (update.message &&
          String(update.message.chat.id) === String(TELEGRAM.chatId) &&
          update.message.text) {
        messages.push({
          text: update.message.text.trim(),
          date: new Date(update.message.date * 1000).toISOString(),
          messageId: update.message.message_id,
          updateId: update.update_id,
        });
      }
    }

    return { messages, lastUpdateId: newLastId };
  } catch (err) {
    console.error(`[accountability/telegram] Poll error: ${err.message}`);
    return { messages: [], lastUpdateId: lastUpdateId };
  }
}

// ── Message Templates ────────────────────────────────────────────────────────

const TEMPLATES = {
  bedtimeNudge: (session) => {
    const lines = ['🌙 *Time to wind down, Jeff.*'];
    if (session) {
      lines.push(`\nYou've got *${session.class_name || session.session_type}* tomorrow.`);
      lines.push('Get your bag ready now.');
    }
    lines.push('\nReply *LIGHTS OUT* when you\'re done for the night.');
    return lines.join('\n');
  },

  bedtimeEscalation: () =>
    '⚠️ *You\'re still up.*\n\nLate nights = no energy = skip gym = the cycle continues.\n\nPut the phone down. Tomorrow\'s session is at risk.',

  morningPlan: (sessions, streak) => {
    const lines = ['☀️ *Good morning, Jeff.*'];
    if (sessions.length > 0) {
      lines.push('\nToday\'s plan:');
      for (const s of sessions) {
        lines.push(`• *${s.class_name || s.session_type}* at ${s.start_time || 'TBD'}`);
      }
      lines.push('\nReply *CONFIRM* to lock it in.');
    } else {
      lines.push('\nRest day today. Recover well. 💪');
    }
    if (streak && streak.current > 0) {
      lines.push(`\n🔥 Current streak: ${streak.current} week${streak.current > 1 ? 's' : ''}`);
    }
    return lines.join('\n');
  },

  preSession: (session) => {
    const lines = [`🥊 *${session.class_name || 'Boxing'}* in 90 minutes.`];
    lines.push('\nYou confirmed this morning. Time to follow through.');
    lines.push('\nReply *HEADING OUT* when you leave work.');
    return lines.join('\n');
  },

  preSessionFollowUp: () =>
    '❓ *Missed check-in.*\n\nWhat happened?\n\nReply:\n• *GOING* — on my way\n• *SKIPPING* — not today\n• *RESCHEDULE* — move to another day',

  sessionComplete: (streak) => {
    const lines = ['✅ *Session logged!* Great work, Jeff.'];
    if (streak && streak.current > 0) {
      lines.push(`\n🔥 Streak: ${streak.current} week${streak.current > 1 ? 's' : ''} consistent`);
    }
    if (streak && streak.current >= 7) {
      lines.push('\n🏆 One week solid. Keep it going.');
    }
    return lines.join('\n');
  },

  patternAlert: (pattern) => {
    if (pattern === 'consecutive_skips') {
      return '🚨 *Pattern detected: consecutive skips.*\n\nThe cycle is starting again. But you can break it.\n\nHow about a lighter session? *Bag + 45 at 5pm* — just 45 minutes, in and out.\n\nReply *GOING* to commit to the lighter option.';
    }
    if (pattern === 'late_bedtimes') {
      return '🚨 *Pattern detected: 3+ late nights this week.*\n\nSleep is the keystone. Everything falls apart without it.\n\nTonight: phone down at 10pm. Reply *LIGHTS OUT* when you do.';
    }
    return '⚠️ *Check in with yourself.* How are things going?';
  },

  weeklyReport: (stats) => {
    const { sessions, planned, lateBedtimes, streaks, phase } = stats;
    const target = require('./config').PHASES[phase];
    const lines = [
      '📊 *Weekly Report*',
      '',
      `*Phase ${phase}: ${target.name}*`,
      `Target: ${target.weeklyTarget.total} sessions/week`,
      '',
      `*Sessions completed:* ${sessions.total}/${target.weeklyTarget.total}`,
      `  • Boxing: ${sessions.boxing}/${target.weeklyTarget.boxing}`,
      `  • Gym: ${sessions.gym}/${target.weeklyTarget.gym}`,
      '',
      `*Planned vs actual:* ${planned.completed}/${planned.total} completed, ${planned.skipped} skipped`,
      `*Late bedtimes:* ${lateBedtimes}`,
      '',
    ];

    if (streaks.sessions.current > 0) {
      lines.push(`🔥 *Session streak:* ${streaks.sessions.current} weeks (best: ${streaks.sessions.best})`);
    }
    if (streaks.bedtime.current > 0) {
      lines.push(`😴 *On-time bedtime streak:* ${streaks.bedtime.current} days (best: ${streaks.bedtime.best})`);
    }

    // Trend assessment
    if (sessions.total >= target.weeklyTarget.total) {
      lines.push('\n📈 *Trend: On track!* Keep it up.');
    } else if (sessions.total > 0) {
      lines.push('\n📉 *Trend: Below target.* But you showed up — that counts.');
    } else {
      lines.push('\n⚠️ *Trend: No sessions this week.* Let\'s reset and try again.');
    }

    return lines.join('\n');
  },

  status: (stats) => {
    const phase = require('./config').PHASES[stats.phase];
    const lines = [
      `📋 *Status — Phase ${stats.phase}: ${phase.name}*`,
      '',
      `This week: ${stats.sessions.total}/${phase.weeklyTarget.total} sessions`,
      `Session streak: ${stats.streaks.sessions.current} weeks`,
      `Bedtime streak: ${stats.streaks.bedtime.current} days`,
    ];
    return lines.join('\n');
  },

  help: () => [
    '🤖 *Accountability Bot Commands*',
    '',
    '*Reply keywords:*',
    '• CONFIRM — lock in today\'s session',
    '• HEADING OUT / GOING — on your way to gym',
    '• DONE / TRAINED — log a completed session',
    '• SKIPPING — skip today (reason optional)',
    '• RESCHEDULE — move session to another day',
    '• LIGHTS OUT — confirm bedtime',
    '• STATUS — see your current progress',
    '• HELP — show this menu',
  ].join('\n'),
};

module.exports = {
  sendMessage,
  sendMessageWithKeyboard,
  removeKeyboard,
  getUpdates,
  pollMessages,
  getBotToken,
  TEMPLATES,
};
