'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeModel } = require('./model-utils');
const { logLlmCall, estimateTokensFromChars, estimateCost } = require('./interaction-store');

// --- Auth resolution ---

const AUTH_JSON_PATH = path.join(
  process.env.HOME || '~', '.openclaw', 'agents', 'main', 'agent', 'auth.json'
);

/**
 * Resolve an OpenAI Bearer token via OAuth only.
 * Reads auth.json -> openai-codex.access (OAuth JWT).
 */
function resolveOpenAIAuth() {
  if (!fs.existsSync(AUTH_JSON_PATH)) {
    throw new Error(
      'No OpenAI OAuth credentials found. Run `openclaw login openai-codex` to authenticate.'
    );
  }

  const auth = JSON.parse(fs.readFileSync(AUTH_JSON_PATH, 'utf8'));
  const codex = auth['openai-codex'];
  if (!codex || !codex.access) {
    throw new Error(
      'No openai-codex entry in auth.json. Run `openclaw login openai-codex` to authenticate.'
    );
  }

  // Check expiry
  if (codex.expires && codex.expires < Date.now()) {
    // TODO: implement token refresh using codex.refresh
    // POST to https://auth.openai.com/oauth/token with grant_type=refresh_token
    throw new Error(
      'OpenAI OAuth token has expired. Token refresh not yet implemented. ' +
      'Re-run `openclaw login openai-codex` to re-authenticate.'
    );
  }

  // Warn if expiring within 24h
  if (codex.expires && codex.expires - Date.now() < 24 * 60 * 60 * 1000) {
    console.warn('[openai-chat] OAuth token expires within 24 hours. Consider refreshing.');
  }

  return codex.access;
}

// --- Smoke test ---

const SMOKE_TEST_PROMPT = 'Reply with exactly AUTH_OK and nothing else.';
const SMOKE_TIMEOUT_MS = 20_000;

let _smokeTestPassed = false;
let _smokeTestRunning = null;

async function runOpenAISmokeTest(token) {
  if (_smokeTestPassed) return;
  if (process.env.SKIP_SMOKE_TEST === '1') {
    _smokeTestPassed = true;
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS);

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.3-codex',
        messages: [{ role: 'user', content: SMOKE_TEST_PROMPT }],
        max_tokens: 10,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OpenAI smoke test HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text.includes('AUTH_OK')) {
      throw new Error(`OpenAI smoke test failed: expected AUTH_OK, got: ${text.slice(0, 100)}`);
    }
    _smokeTestPassed = true;
  } finally {
    clearTimeout(timer);
  }
}

// --- Main function ---

/**
 * Call the OpenAI Chat Completions API.
 *
 * This module is the OpenAI leg of the multi-provider system.
 * smart-router.js is the planned home for intelligent model selection
 * (cheapest, fastest, best, specific strategies).
 *
 * @param {object} opts
 * @param {string} [opts.model='gpt-5.3-codex']
 * @param {string} opts.prompt
 * @param {number} [opts.timeoutMs=60000]
 * @param {string} [opts.caller='unknown']
 * @param {boolean} [opts.skipLog=false]
 * @returns {Promise<{ text: string, provider: string }>}
 */
async function runOpenAIChatPrompt({
  model = 'gpt-5.3-codex',
  prompt,
  timeoutMs = 60_000,
  caller = 'unknown',
  skipLog = false,
} = {}) {
  const normalizedModel = normalizeModel(model);
  const token = resolveOpenAIAuth();

  // Deduplicate concurrent smoke tests
  if (!_smokeTestPassed) {
    if (!_smokeTestRunning) {
      _smokeTestRunning = runOpenAISmokeTest(token).finally(() => { _smokeTestRunning = null; });
    }
    await _smokeTestRunning;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  let text = '';
  let inputTokens = estimateTokensFromChars(prompt);
  let outputTokens = 0;
  let error = null;
  let ok = false;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: normalizedModel,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OpenAI API error HTTP ${resp.status}: ${body.slice(0, 500)}`);
    }

    const data = await resp.json();
    text = data.choices?.[0]?.message?.content || '';

    // Prefer API-reported token counts, fall back to char estimate
    if (data.usage) {
      inputTokens = data.usage.prompt_tokens || inputTokens;
      outputTokens = data.usage.completion_tokens || outputTokens;
    } else {
      outputTokens = estimateTokensFromChars(text);
    }
    ok = true;
  } catch (err) {
    error = err.message;
    throw err;
  } finally {
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    if (!skipLog) {
      logLlmCall({
        provider: 'openai',
        model: normalizedModel,
        caller,
        prompt,
        response: text,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_estimate: estimateCost(normalizedModel, inputTokens, outputTokens),
        duration_ms: durationMs,
        ok,
        error,
      });
    }
  }

  return { text, provider: 'openai' };
}

module.exports = { runOpenAIChatPrompt };
