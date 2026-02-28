'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeModel } = require('./model-utils');
const { logLlmCall, estimateTokensFromChars, estimateCost } = require('./interaction-store');

// --- Auth resolution ---

const AUTH_JSON_PATH = path.join(
  process.env.HOME || '~', '.openclaw', 'agents', 'main', 'agent', 'auth.json'
);

// Deduplication for concurrent refresh attempts
let _refreshRunning = null;

/**
 * Refresh the OpenAI OAuth token using the refresh_token grant.
 * Updates auth.json with new access/refresh/expires values.
 * @returns {Promise<string>} The new access token
 */
async function refreshOpenAIToken() {
  // Deduplicate concurrent refreshes
  if (_refreshRunning) return _refreshRunning;

  _refreshRunning = (async () => {
    if (!fs.existsSync(AUTH_JSON_PATH)) {
      throw new Error('No auth.json to refresh. Run `openclaw login openai-codex`.');
    }

    const auth = JSON.parse(fs.readFileSync(AUTH_JSON_PATH, 'utf8'));
    const codex = auth['openai-codex'];
    if (!codex || !codex.refresh) {
      throw new Error('No refresh token available. Run `openclaw login openai-codex`.');
    }

    // Extract client_id from JWT payload (fallback to known app ID)
    let clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
    try {
      const parts = codex.access.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (payload.client_id) clientId = payload.client_id;
      }
    } catch { /* use fallback */ }

    console.log('[openai-chat] Refreshing OAuth token...');

    const resp = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: codex.refresh,
        client_id: clientId,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Token refresh failed HTTP ${resp.status}: ${body.slice(0, 300)}`);
    }

    const data = await resp.json();
    const newAccess = data.access_token;
    const newRefresh = data.refresh_token || codex.refresh;
    const expiresIn = data.expires_in || 3600;
    const newExpires = Date.now() + expiresIn * 1000;

    // Update auth.json
    auth['openai-codex'] = {
      access: newAccess,
      refresh: newRefresh,
      expires: newExpires,
    };
    fs.writeFileSync(AUTH_JSON_PATH, JSON.stringify(auth, null, 2) + '\n', 'utf8');

    // Reset smoke test so next call re-validates
    _smokeTestPassed = false;

    console.log(`[openai-chat] Token refreshed, expires in ${Math.round(expiresIn / 3600)}h`);
    return newAccess;
  })().finally(() => { _refreshRunning = null; });

  return _refreshRunning;
}

/**
 * Resolve an OpenAI Bearer token via OAuth only.
 * Reads auth.json -> openai-codex.access (OAuth JWT).
 * Auto-refreshes if expired.
 * @returns {Promise<string>}
 */
async function resolveOpenAIAuth() {
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

  // Auto-refresh if expired
  if (codex.expires && codex.expires < Date.now()) {
    return await refreshOpenAIToken();
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
  const token = await resolveOpenAIAuth();

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

module.exports = { runOpenAIChatPrompt, refreshOpenAIToken };
