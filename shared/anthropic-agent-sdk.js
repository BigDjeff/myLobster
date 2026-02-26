'use strict';

const fs = require('fs');
const path = require('path');
const { query } = require('@anthropic-ai/claude-agent-sdk');
const { normalizeAnthropicModel } = require('./model-utils');
const { logLlmCall, estimateTokensFromChars, estimateCost } = require('./interaction-store');

const SMOKE_TEST_PROMPT = 'Reply with exactly AUTH_OK and nothing else.';
const SMOKE_TIMEOUT_MS = 20_000;

let _smokeTestPassed = false;
let _smokeTestRunning = null;

function resolveOAuthToken() {
  // 1. Check env var
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    if (process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY conflicts with OAuth mode. Remove it from your environment.');
    }
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  // 2. Parse from ~/.agent/.env
  const envPath = path.join(process.env.HOME || '~', '.agent', '.env');
  if (fs.existsSync(envPath)) {
    const contents = fs.readFileSync(envPath, 'utf8');
    const match = contents.match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m);
    if (match) {
      const token = match[1].trim().replace(/^["']|["']$/g, '');
      if (token) {
        if (process.env.ANTHROPIC_API_KEY) {
          throw new Error('ANTHROPIC_API_KEY conflicts with OAuth mode. Remove it from your environment.');
        }
        return token;
      }
    }
  }

  return null;
}

async function runSmokeTest(token) {
  if (_smokeTestPassed) return;
  if (process.env.SKIP_SMOKE_TEST === '1') {
    _smokeTestPassed = true;
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS);

  try {
    let text = '';
    const messages = [{ role: 'user', content: SMOKE_TEST_PROMPT }];
    for await (const msg of query({ prompt: SMOKE_TEST_PROMPT, tools: [], maxTurns: 1, abortSignal: controller.signal })) {
      if (msg.type === 'result') {
        text = msg.result || '';
      } else if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text') text += block.text;
        }
      }
    }
    if (!text.includes('AUTH_OK')) {
      throw new Error(`Smoke test failed: expected AUTH_OK, got: ${text.slice(0, 100)}`);
    }
    _smokeTestPassed = true;
  } finally {
    clearTimeout(timer);
  }
}

async function runAnthropicAgentPrompt({
  model = 'claude-sonnet-4-5',
  prompt,
  timeoutMs = 60_000,
  caller = 'unknown',
  maxTurns = 1,
  skipLog = false,
} = {}) {
  const normalizedModel = normalizeAnthropicModel(model);
  const token = resolveOAuthToken();

  // Deduplicate concurrent smoke tests
  if (!_smokeTestPassed) {
    if (!_smokeTestRunning) {
      _smokeTestRunning = runSmokeTest(token).finally(() => { _smokeTestRunning = null; });
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
    for await (const msg of query({
      prompt,
      model: normalizedModel,
      tools: [],
      maxTurns,
      abortSignal: controller.signal,
    })) {
      if (msg.type === 'result') {
        text = msg.result || '';
        if (msg.usage) {
          inputTokens = msg.usage.input_tokens || inputTokens;
          outputTokens = msg.usage.output_tokens || outputTokens;
        }
      } else if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text') text += block.text;
        }
        if (msg.message.usage) {
          inputTokens = msg.message.usage.input_tokens || inputTokens;
          outputTokens = msg.message.usage.output_tokens || outputTokens;
        }
      }
    }
    outputTokens = outputTokens || estimateTokensFromChars(text);
    ok = true;
  } catch (err) {
    error = err.message;
    throw err;
  } finally {
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    if (!skipLog) {
      logLlmCall({
        provider: 'anthropic',
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

  return { text, provider: 'anthropic' };
}

module.exports = { runAnthropicAgentPrompt };
