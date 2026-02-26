'use strict';

const { isAnthropicModel, normalizeAnthropicModel, detectModelProvider } = require('./model-utils');
const { runAnthropicAgentPrompt } = require('./anthropic-agent-sdk');

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
  const normalized = normalizeAnthropicModel(model);
  const provider = detectModelProvider(normalized);
  const start = Date.now();

  if (isAnthropicModel(normalized)) {
    const result = await runAnthropicAgentPrompt({ model: normalized, prompt, timeoutMs, caller, skipLog });
    return { ...result, durationMs: Date.now() - start };
  }

  if (provider === 'openai') {
    throw new Error(`OpenAI routing not yet implemented for model: ${normalized}`);
  }

  throw new Error(`Unknown provider for model: ${model}`);
}

/**
 * Convenience wrapper defaulting to claude-sonnet-4-5.
 */
async function runClaude(prompt, opts = {}) {
  return runLlm(prompt, { model: 'claude-sonnet-4-5', ...opts });
}

module.exports = { runLlm, runClaude };
