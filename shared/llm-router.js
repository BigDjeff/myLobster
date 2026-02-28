'use strict';

const { isAnthropicModel, normalizeModel, detectModelProvider } = require('./model-utils');
const { runAnthropicAgentPrompt } = require('./anthropic-agent-sdk');
const { runOpenAIChatPrompt } = require('./openai-chat');

/*
 * Future: smart routing (planned in smart-router.js)
 *
 * Strategy options:
 *   - "cheapest"  — pick the cheapest model that can handle the task
 *   - "fastest"   — pick the model with the lowest p50 latency from llm_calls.db
 *   - "best"      — pick the most capable model regardless of cost
 *   - "specific"  — caller explicitly names a model (current behavior)
 *
 * Implementation sketch:
 *   smart-router.js would query llm_calls.db for per-model stats (avg latency,
 *   error rate, cost) and select based on the chosen strategy.
 *   See also: config/model-routing.json (referenced in SUBAGENT-POLICY.md).
 */

/**
 * Single entry point for all LLM calls.
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.model='claude-sonnet-4-5']
 * @param {number} [opts.timeoutMs=60000]
 * @param {string} [opts.caller='unknown']
 * @param {boolean} [opts.skipLog=false]
 * @returns {Promise<{ text: string, durationMs: number, provider: string }>}
 */
async function runLlm(prompt, {
  model = 'claude-sonnet-4-5',
  timeoutMs = 60_000,
  caller = 'unknown',
  skipLog = false,
} = {}) {
  const normalized = normalizeModel(model);
  const provider = detectModelProvider(normalized);
  const start = Date.now();

  if (isAnthropicModel(normalized)) {
    const result = await runAnthropicAgentPrompt({ model: normalized, prompt, timeoutMs, caller, skipLog });
    return { ...result, durationMs: Date.now() - start };
  }

  if (provider === 'openai') {
    const result = await runOpenAIChatPrompt({ model: normalized, prompt, timeoutMs, caller, skipLog });
    return { ...result, durationMs: Date.now() - start };
  }

  throw new Error(`Unknown provider for model: ${model}`);
}

/**
 * Convenience wrapper defaulting to claude-sonnet-4-5.
 */
async function runClaude(prompt, opts = {}) {
  return runLlm(prompt, { model: 'claude-sonnet-4-5', ...opts });
}

/**
 * Convenience wrapper defaulting to gpt-5.3-codex.
 */
async function runOpenAI(prompt, opts = {}) {
  return runLlm(prompt, { model: 'gpt-5.3-codex', ...opts });
}

module.exports = { runLlm, runClaude, runOpenAI };
