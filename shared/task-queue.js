'use strict';

/**
 * task-queue.js — SQLite-backed task queue for swarm/decomposition coordination.
 *
 * Provides atomic task claiming, status tracking, and swarm grouping.
 * Used by task-decomposer for orchestrating subtasks and by swarm workers
 * for parallel work distribution.
 *
 * DB: workspace/data/swarm_tasks.db (separate from llm_calls.db)
 * Uses WAL mode, same pattern as interaction-store.js.
 */

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'swarm_tasks.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS swarm_tasks (
      id           TEXT PRIMARY KEY,
      swarm_id     TEXT NOT NULL,
      seq          INTEGER NOT NULL DEFAULT 0,
      description  TEXT NOT NULL,
      prompt       TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      agent_id     TEXT,
      model        TEXT,
      strategy     TEXT,
      mode         TEXT NOT NULL DEFAULT 'inline',
      result       TEXT,
      error        TEXT,
      created_at   TEXT NOT NULL,
      claimed_at   TEXT,
      completed_at TEXT,
      metadata     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_swarm_tasks_swarm ON swarm_tasks(swarm_id);
    CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status ON swarm_tasks(status);
  `);
  return _db;
}

/**
 * Create a swarm with multiple tasks.
 * @param {object} opts
 * @param {string} [opts.swarmId] - Unique swarm ID (auto-generated if omitted)
 * @param {Array<{description: string, prompt?: string, model?: string, strategy?: string, mode?: string, metadata?: object}>} opts.tasks
 * @returns {{ swarmId: string, taskIds: string[] }}
 */
function createSwarm({ swarmId, tasks }) {
  const db = getDb();
  const sid = swarmId || `swarm-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const taskIds = [];

  const insert = db.prepare(`
    INSERT INTO swarm_tasks (id, swarm_id, seq, description, prompt, status, model, strategy, mode, created_at, metadata)
    VALUES (@id, @swarm_id, @seq, @description, @prompt, 'pending', @model, @strategy, @mode, @created_at, @metadata)
  `);

  const insertAll = db.transaction((taskList) => {
    for (let i = 0; i < taskList.length; i++) {
      const t = taskList[i];
      const id = `${sid}-task-${i}`;
      insert.run({
        id,
        swarm_id: sid,
        seq: i,
        description: t.description,
        prompt: t.prompt || null,
        model: t.model || null,
        strategy: t.strategy || null,
        mode: t.mode || 'inline',
        created_at: now,
        metadata: t.metadata ? JSON.stringify(t.metadata) : null,
      });
      taskIds.push(id);
    }
  });

  insertAll(tasks);
  return { swarmId: sid, taskIds };
}

/**
 * Atomically claim the next pending task in a swarm.
 * Returns null if no tasks available (or another worker got it).
 * @param {string} swarmId
 * @param {string} agentId
 * @returns {object|null}
 */
function claimTask(swarmId, agentId) {
  const db = getDb();
  const task = db.prepare(
    `SELECT id FROM swarm_tasks WHERE swarm_id = ? AND status = 'pending' ORDER BY seq LIMIT 1`
  ).get(swarmId);
  if (!task) return null;

  const changes = db.prepare(
    `UPDATE swarm_tasks SET status='claimed', agent_id=?, claimed_at=? WHERE id=? AND status='pending'`
  ).run(agentId, new Date().toISOString(), task.id);

  if (changes.changes === 0) return null; // another worker got it
  return db.prepare('SELECT * FROM swarm_tasks WHERE id = ?').get(task.id);
}

/**
 * Mark a task as running.
 * @param {string} taskId
 */
function markRunning(taskId) {
  const db = getDb();
  db.prepare(`UPDATE swarm_tasks SET status='running' WHERE id=?`).run(taskId);
}

/**
 * Mark a task as completed with a result.
 * @param {string} taskId
 * @param {string} result
 */
function completeTask(taskId, result) {
  const db = getDb();
  db.prepare(
    `UPDATE swarm_tasks SET status='done', result=?, completed_at=? WHERE id=?`
  ).run(result, new Date().toISOString(), taskId);
}

/**
 * Mark a task as failed with an error.
 * @param {string} taskId
 * @param {string} error
 */
function failTask(taskId, error) {
  const db = getDb();
  db.prepare(
    `UPDATE swarm_tasks SET status='failed', error=?, completed_at=? WHERE id=?`
  ).run(error, new Date().toISOString(), taskId);
}

/**
 * Reset a task back to pending (for stale recovery).
 * @param {string} taskId
 */
function resetTask(taskId) {
  const db = getDb();
  db.prepare(
    `UPDATE swarm_tasks SET status='pending', agent_id=NULL, claimed_at=NULL WHERE id=?`
  ).run(taskId);
}

/**
 * Get status summary for a swarm.
 * @param {string} swarmId
 * @returns {{ total: number, pending: number, claimed: number, running: number, done: number, failed: number }}
 */
function getSwarmStatus(swarmId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT status, COUNT(*) as cnt FROM swarm_tasks WHERE swarm_id = ? GROUP BY status`
  ).all(swarmId);

  const status = { total: 0, pending: 0, claimed: 0, running: 0, done: 0, failed: 0 };
  for (const row of rows) {
    status[row.status] = row.cnt;
    status.total += row.cnt;
  }
  return status;
}

/**
 * Get all results for a completed swarm.
 * @param {string} swarmId
 * @returns {Array<{id: string, description: string, status: string, result: string, error: string}>}
 */
function getSwarmResults(swarmId) {
  const db = getDb();
  return db.prepare(
    `SELECT id, seq, description, status, result, error FROM swarm_tasks WHERE swarm_id = ? ORDER BY seq`
  ).all(swarmId);
}

/**
 * Check if all tasks in a swarm are terminal (done or failed).
 * @param {string} swarmId
 * @returns {boolean}
 */
function isSwarmComplete(swarmId) {
  const status = getSwarmStatus(swarmId);
  return status.total > 0 && status.pending === 0 && status.claimed === 0 && status.running === 0;
}

/**
 * Get a single task by ID.
 * @param {string} taskId
 * @returns {object|null}
 */
function getTask(taskId) {
  const db = getDb();
  return db.prepare('SELECT * FROM swarm_tasks WHERE id = ?').get(taskId) || null;
}

/**
 * Get stale tasks (claimed or running for longer than the given minutes).
 * @param {number} [staleMinutes=15]
 * @returns {object[]}
 */
function getStaleTasks(staleMinutes = 15) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM swarm_tasks
     WHERE status IN ('claimed', 'running')
     AND claimed_at < datetime('now', ?)
    `
  ).all(`-${staleMinutes} minutes`);
}

/**
 * Get all active (non-terminal) swarm IDs.
 * @returns {string[]}
 */
function getActiveSwarms() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT DISTINCT swarm_id FROM swarm_tasks WHERE status IN ('pending', 'claimed', 'running')`
  ).all();
  return rows.map(r => r.swarm_id);
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
  createSwarm,
  claimTask,
  markRunning,
  completeTask,
  failTask,
  resetTask,
  getSwarmStatus,
  getSwarmResults,
  isSwarmComplete,
  getTask,
  getStaleTasks,
  getActiveSwarms,
  closeDb,
  DB_PATH,
};
