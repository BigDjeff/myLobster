'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'llm_calls.db');

// USD per 1M tokens [input, output]
const PRICING = {
  'claude-opus-4-5':    [15,    75],
  'claude-sonnet-4-5':  [3,     15],
  'claude-haiku-4-5':   [0.25,  1.25],
  'claude-opus-4':      [15,    75],
  'claude-sonnet-4':    [3,     15],
  'claude-haiku-4':     [0.25,  1.25],
  'claude-sonnet-3-5':  [3,     15],
  'gpt-4o':             [5,     15],
  'gpt-4-turbo':        [10,    30],
  'gpt-3.5-turbo':      [0.5,   1.5],
  'gpt-5.3-codex':      [2,     8],    // TODO: verify pricing when officially published
};

const SECRET_PATTERN = /sk-[a-zA-Z0-9]{20,}|Bearer [a-zA-Z0-9\-._~+/]+=*/g;

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS llm_calls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     TEXT    NOT NULL,
      provider      TEXT,
      model         TEXT,
      caller        TEXT,
      prompt        TEXT,
      response      TEXT,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      cost_estimate REAL,
      duration_ms   INTEGER,
      ok            INTEGER,
      error         TEXT
    )
  `);
  return _db;
}

function redact(str) {
  if (!str) return str;
  return str.replace(SECRET_PATTERN, '[REDACTED]');
}

function truncate(str, max = 10000) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) + '…[truncated]' : str;
}

function estimateTokensFromChars(str) {
  if (!str) return 0;
  return Math.ceil(str.length / 4);
}

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  const [inputRate, outputRate] = pricing;
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

function logLlmCall(params) {
  // Fire and forget
  setImmediate(() => {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT INTO llm_calls
          (timestamp, provider, model, caller, prompt, response,
           input_tokens, output_tokens, cost_estimate, duration_ms, ok, error)
        VALUES
          (@timestamp, @provider, @model, @caller, @prompt, @response,
           @input_tokens, @output_tokens, @cost_estimate, @duration_ms, @ok, @error)
      `);
      stmt.run({
        timestamp:     new Date().toISOString(),
        provider:      params.provider || null,
        model:         params.model || null,
        caller:        params.caller || null,
        prompt:        truncate(redact(params.prompt)),
        response:      truncate(redact(params.response)),
        input_tokens:  params.input_tokens || 0,
        output_tokens: params.output_tokens || 0,
        cost_estimate: params.cost_estimate || 0,
        duration_ms:   params.duration_ms || 0,
        ok:            params.ok ? 1 : 0,
        error:         params.error || null,
      });
    } catch (err) {
      console.error('[interaction-store] log error:', err.message);
    }
  });
}

module.exports = { getDb, logLlmCall, estimateTokensFromChars, estimateCost };
