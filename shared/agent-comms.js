'use strict';

/**
 * agent-comms.js — Gap 2: Agent-to-agent communication.
 *
 * SQLite-backed message passing between agents. Enables agents to share
 * context, intermediate results, and coordination signals.
 *
 * Features:
 *   - Channel-based messaging (broadcast to a topic)
 *   - Direct agent-to-agent messages
 *   - Message types: data, signal, context, error
 *   - Read cursors per agent (each agent tracks what it has read)
 *   - TTL-based auto-cleanup of old messages
 *
 * DB: workspace/data/agent_comms.db
 */

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'agent_comms.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      channel    TEXT NOT NULL,
      sender     TEXT NOT NULL,
      recipient  TEXT,
      type       TEXT NOT NULL DEFAULT 'data',
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    CREATE TABLE IF NOT EXISTS read_cursors (
      agent_id TEXT NOT NULL,
      channel  TEXT NOT NULL,
      last_read_id TEXT,
      last_read_at TEXT,
      PRIMARY KEY (agent_id, channel)
    );
  `);
  return _db;
}

/**
 * Post a message to a channel.
 * @param {object} opts
 * @param {string} opts.channel - Channel name (e.g. 'swarm-abc', 'review', 'global')
 * @param {string} opts.sender - Agent ID of the sender
 * @param {string} [opts.recipient] - Specific recipient agent ID (null = broadcast)
 * @param {string} [opts.type='data'] - Message type: data, signal, context, error
 * @param {*} opts.payload - Message payload (will be JSON-stringified if not a string)
 * @param {number} [opts.ttlMinutes] - Auto-expire after N minutes
 * @returns {string} Message ID
 */
function postMessage({ channel, sender, recipient, type = 'data', payload, ttlMinutes }) {
  const db = getDb();
  const id = `msg-${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const expiresAt = ttlMinutes
    ? new Date(Date.now() + ttlMinutes * 60_000).toISOString()
    : null;

  db.prepare(`
    INSERT INTO messages (id, channel, sender, recipient, type, payload, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, channel, sender, recipient || null, type, payloadStr, now, expiresAt);

  return id;
}

/**
 * Read messages from a channel.
 * @param {string} channel
 * @param {object} [opts]
 * @param {string} [opts.agentId] - If provided, only returns unread messages for this agent
 * @param {string} [opts.type] - Filter by message type
 * @param {string} [opts.since] - ISO timestamp: only messages after this time
 * @param {number} [opts.limit=50]
 * @returns {Array<{id: string, channel: string, sender: string, recipient: string, type: string, payload: string, created_at: string}>}
 */
function readMessages(channel, opts = {}) {
  const db = getDb();
  let query = `SELECT * FROM messages WHERE channel = ?`;
  const params = [channel];

  // Exclude expired messages
  query += ` AND (expires_at IS NULL OR expires_at > datetime('now'))`;

  // Filter for recipient
  if (opts.agentId) {
    query += ` AND (recipient IS NULL OR recipient = ?)`;
    params.push(opts.agentId);

    // Only unread messages (after cursor)
    const cursor = db.prepare(
      `SELECT last_read_id FROM read_cursors WHERE agent_id = ? AND channel = ?`
    ).get(opts.agentId, channel);

    if (cursor && cursor.last_read_id) {
      // Use rowid for cursor comparison — handles same-second messages correctly
      query += ` AND rowid > (SELECT rowid FROM messages WHERE id = ?)`;
      params.push(cursor.last_read_id);
    }
  }

  if (opts.type) {
    query += ` AND type = ?`;
    params.push(opts.type);
  }

  if (opts.since) {
    query += ` AND created_at > ?`;
    params.push(opts.since);
  }

  query += ` ORDER BY created_at ASC LIMIT ?`;
  params.push(opts.limit || 50);

  const messages = db.prepare(query).all(...params);

  // Update read cursor if agentId provided and messages returned
  if (opts.agentId && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    db.prepare(`
      INSERT INTO read_cursors (agent_id, channel, last_read_id, last_read_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id, channel) DO UPDATE SET last_read_id=excluded.last_read_id, last_read_at=excluded.last_read_at
    `).run(opts.agentId, channel, lastMsg.id, new Date().toISOString());
  }

  return messages;
}

/**
 * Send a direct message to a specific agent.
 * @param {string} sender
 * @param {string} recipient
 * @param {*} payload
 * @param {object} [opts]
 * @param {string} [opts.type='data']
 * @param {number} [opts.ttlMinutes]
 * @returns {string} Message ID
 */
function sendDirect(sender, recipient, payload, opts = {}) {
  return postMessage({
    channel: `dm:${[sender, recipient].sort().join(':')}`,
    sender,
    recipient,
    type: opts.type || 'data',
    payload,
    ttlMinutes: opts.ttlMinutes,
  });
}

/**
 * Read direct messages for an agent.
 * @param {string} agentId
 * @param {string} [fromAgent] - Specific sender to filter
 * @param {object} [opts]
 * @returns {object[]}
 */
function readDirect(agentId, fromAgent, opts = {}) {
  const db = getDb();
  let query = `SELECT * FROM messages WHERE recipient = ?`;
  const params = [agentId];

  query += ` AND (expires_at IS NULL OR expires_at > datetime('now'))`;

  if (fromAgent) {
    query += ` AND sender = ?`;
    params.push(fromAgent);
  }

  query += ` ORDER BY created_at ASC LIMIT ?`;
  params.push(opts.limit || 50);

  return db.prepare(query).all(...params);
}

/**
 * Broadcast a signal to a channel (lightweight coordination).
 * @param {string} channel
 * @param {string} sender
 * @param {string} signal - Signal name (e.g. 'ready', 'done', 'abort', 'handoff')
 * @param {*} [data] - Optional data payload
 * @returns {string} Message ID
 */
function broadcastSignal(channel, sender, signal, data) {
  return postMessage({
    channel,
    sender,
    type: 'signal',
    payload: { signal, data: data || null },
    ttlMinutes: 60,
  });
}

/**
 * Share context between agents (e.g. intermediate results).
 * @param {string} channel
 * @param {string} sender
 * @param {string} key - Context key
 * @param {*} value - Context value
 * @returns {string} Message ID
 */
function shareContext(channel, sender, key, value) {
  return postMessage({
    channel,
    sender,
    type: 'context',
    payload: { key, value },
    ttlMinutes: 120,
  });
}

/**
 * Get the latest context value for a key in a channel.
 * @param {string} channel
 * @param {string} key
 * @returns {*} Latest value or null
 */
function getContext(channel, key) {
  const db = getDb();
  const msg = db.prepare(`
    SELECT payload FROM messages
    WHERE channel = ? AND type = 'context'
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC LIMIT 1
  `).get(channel);

  if (!msg) return null;
  try {
    const parsed = JSON.parse(msg.payload);
    if (parsed.key === key) return parsed.value;

    // Search through recent context messages for the right key
    const msgs = db.prepare(`
      SELECT payload FROM messages
      WHERE channel = ? AND type = 'context'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY created_at DESC LIMIT 20
    `).all(channel);

    for (const m of msgs) {
      const p = JSON.parse(m.payload);
      if (p.key === key) return p.value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clean up expired messages.
 * @returns {number} Number of deleted messages
 */
function cleanExpired() {
  const db = getDb();
  const result = db.prepare(
    `DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`
  ).run();
  return result.changes;
}

/**
 * Get all channels an agent has received messages on.
 * @param {string} agentId
 * @returns {string[]}
 */
function getAgentChannels(agentId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT channel FROM messages WHERE recipient IS NULL OR recipient = ?
    ORDER BY channel
  `).all(agentId);
  return rows.map(r => r.channel);
}

/**
 * Close the database connection (for clean test teardown).
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  getDb,
  postMessage,
  readMessages,
  sendDirect,
  readDirect,
  broadcastSignal,
  shareContext,
  getContext,
  cleanExpired,
  getAgentChannels,
  closeDb,
  DB_PATH,
};
