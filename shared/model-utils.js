'use strict';

// Friendly alias -> official model name
const MODEL_ALIASES = {
  'opus-4':    'claude-opus-4-5',
  'sonnet-4':  'claude-sonnet-4-5',
  'haiku-4':   'claude-haiku-4-5',
  'opus-3':    'claude-opus-4',
  'sonnet-3':  'claude-sonnet-3-5',
  'gpt-4o':    'gpt-4o',
  'gpt-4':     'gpt-4-turbo',
  'gpt-3.5':   'gpt-3.5-turbo',
};

// True if the model name looks like an Anthropic model
function isAnthropicModel(model) {
  if (!model) return false;
  const lower = model.toLowerCase();
  return (
    lower.includes('claude') ||
    lower.includes('opus') ||
    lower.includes('sonnet') ||
    lower.includes('haiku')
  );
}

// Resolve alias, strip provider prefix (e.g. "anthropic/claude-sonnet-4-5" -> "claude-sonnet-4-5")
function normalizeAnthropicModel(model) {
  if (!model) return model;
  // Strip provider prefix
  let normalized = model.replace(/^anthropic\//i, '').replace(/^openai\//i, '');
  // Resolve alias
  if (MODEL_ALIASES[normalized]) normalized = MODEL_ALIASES[normalized];
  return normalized;
}

// Returns "anthropic", "openai", or null
function detectModelProvider(model) {
  if (!model) return null;
  const normalized = normalizeAnthropicModel(model);
  if (isAnthropicModel(normalized)) return 'anthropic';
  const lower = normalized.toLowerCase();
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) return 'openai';
  return null;
}

module.exports = { MODEL_ALIASES, isAnthropicModel, normalizeAnthropicModel, detectModelProvider };
