'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TASKS_FILE = path.join(__dirname, '..', 'data', 'active-tasks.json');

function readRegistry() {
  if (!fs.existsSync(TASKS_FILE)) {
    return { version: 1, tasks: [] };
  }
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
}

function writeRegistry(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Add a new task to the registry.
 * @param {object} opts
 * @param {string} opts.id - Unique task ID (auto-generated if omitted)
 * @param {string} opts.description - What the task is about
 * @param {string} [opts.agent='claude-sonnet'] - Agent type
 * @param {string} [opts.model='claude-sonnet-4-5'] - Model ID
 * @param {string} [opts.tmuxSession] - tmux session name
 * @param {string} [opts.worktree] - Git branch/worktree name
 * @param {string} [opts.originalPrompt] - The prompt given to the agent
 * @param {number} [opts.maxRetries=3] - Max retry attempts
 * @param {boolean} [opts.notifyOnComplete=true] - Send notification when done
 * @returns {object} The created task
 */
function addTask(opts) {
  const registry = readRegistry();
  const task = {
    id: opts.id || crypto.randomBytes(4).toString('hex'),
    description: opts.description || '',
    agent: opts.agent || 'claude-sonnet',
    model: opts.model || 'claude-sonnet-4-5',
    tmuxSession: opts.tmuxSession || null,
    worktree: opts.worktree || null,
    originalPrompt: opts.originalPrompt || null,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    retryCount: 0,
    maxRetries: opts.maxRetries != null ? opts.maxRetries : 3,
    notifyOnComplete: opts.notifyOnComplete != null ? opts.notifyOnComplete : true,
    notified: false,
    result: null,
    error: null,
    lastError: null,
  };
  registry.tasks.push(task);
  writeRegistry(registry);
  return task;
}

/**
 * Update fields on an existing task.
 * @param {string} id - Task ID
 * @param {object} updates - Fields to merge
 * @returns {object|null} Updated task or null if not found
 */
function updateTask(id, updates) {
  const registry = readRegistry();
  const idx = registry.tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  Object.assign(registry.tasks[idx], updates);
  writeRegistry(registry);
  return registry.tasks[idx];
}

/**
 * Get all tasks with status "running".
 * @returns {object[]}
 */
function getRunningTasks() {
  return readRegistry().tasks.filter(t => t.status === 'running');
}

/**
 * Get all tasks (any status).
 * @returns {object[]}
 */
function getAllTasks() {
  return readRegistry().tasks;
}

/**
 * Get a single task by ID.
 * @param {string} id
 * @returns {object|null}
 */
function getTask(id) {
  return readRegistry().tasks.find(t => t.id === id) || null;
}

/**
 * Remove a task from the registry entirely.
 * @param {string} id
 * @returns {boolean} true if removed
 */
function removeTask(id) {
  const registry = readRegistry();
  const before = registry.tasks.length;
  registry.tasks = registry.tasks.filter(t => t.id !== id);
  if (registry.tasks.length < before) {
    writeRegistry(registry);
    return true;
  }
  return false;
}

/**
 * Get tasks that are completed but not yet notified.
 * @returns {object[]}
 */
function getUnnotifiedCompletedTasks() {
  return readRegistry().tasks.filter(
    t => (t.status === 'done' || t.status === 'failed') && !t.notified
  );
}

/**
 * Mark a task as notified.
 * @param {string} id
 */
function markNotified(id) {
  return updateTask(id, { notified: true });
}

module.exports = {
  readRegistry,
  addTask,
  updateTask,
  getRunningTasks,
  getAllTasks,
  getTask,
  removeTask,
  getUnnotifiedCompletedTasks,
  markNotified,
  TASKS_FILE,
};
