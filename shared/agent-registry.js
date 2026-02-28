'use strict';

/**
 * agent-registry.js — Static model capability registry.
 *
 * Maps model names to capabilities, tiers, and cost metadata.
 * Used by smart-router for strategy-based model selection and
 * by task-decomposer for matching tasks to model capabilities.
 *
 * No I/O, no database — pure data + lookup functions.
 */

const AGENT_REGISTRY = {
  'claude-opus-4-5': {
    provider: 'anthropic',
    agentType: 'claude-opus',
    tier: 'best',
    capabilities: ['coding', 'reasoning', 'long-context', 'creative', 'review'],
    costTier: 3,
    defaultTimeoutMs: 120_000,
  },
  'claude-sonnet-4-5': {
    provider: 'anthropic',
    agentType: 'claude-sonnet',
    tier: 'balanced',
    capabilities: ['coding', 'reasoning', 'long-context', 'review'],
    costTier: 2,
    defaultTimeoutMs: 60_000,
  },
  'claude-haiku-4-5': {
    provider: 'anthropic',
    agentType: 'claude-haiku',
    tier: 'cheap',
    capabilities: ['classification', 'extraction', 'simple-reasoning', 'review'],
    costTier: 1,
    defaultTimeoutMs: 30_000,
  },
  'gpt-5.3-codex': {
    provider: 'openai',
    agentType: 'codex',
    tier: 'balanced',
    capabilities: ['coding', 'reasoning'],
    costTier: 2,
    defaultTimeoutMs: 60_000,
  },
  'gpt-4o': {
    provider: 'openai',
    agentType: null,
    tier: 'balanced',
    capabilities: ['reasoning', 'multimodal'],
    costTier: 2,
    defaultTimeoutMs: 60_000,
  },
};

// Tier ordering: cheap < balanced < best
const TIER_ORDER = { cheap: 0, balanced: 1, best: 2 };

/**
 * Get info for a specific model.
 * @param {string} model
 * @returns {object|null}
 */
function getAgentInfo(model) {
  return AGENT_REGISTRY[model] || null;
}

/**
 * Get all model names matching a tier.
 * @param {'cheap'|'balanced'|'best'} tier
 * @returns {string[]}
 */
function getModelsByTier(tier) {
  return Object.keys(AGENT_REGISTRY).filter(m => AGENT_REGISTRY[m].tier === tier);
}

/**
 * Get all model names that have a given capability.
 * @param {string} capability
 * @returns {string[]}
 */
function getModelsWithCapability(capability) {
  return Object.keys(AGENT_REGISTRY).filter(
    m => AGENT_REGISTRY[m].capabilities.includes(capability)
  );
}

/**
 * Get all registered model names.
 * @returns {string[]}
 */
function getAllModels() {
  return Object.keys(AGENT_REGISTRY);
}

/**
 * Get the cheapest model (lowest costTier) from a candidate list.
 * @param {string[]} [candidates] - Model names to consider (default: all)
 * @returns {string|null}
 */
function getCheapestModel(candidates) {
  const pool = candidates || getAllModels();
  let best = null;
  let bestCost = Infinity;
  for (const m of pool) {
    const info = AGENT_REGISTRY[m];
    if (info && info.costTier < bestCost) {
      bestCost = info.costTier;
      best = m;
    }
  }
  return best;
}

/**
 * Get the best model (highest tier) from a candidate list.
 * @param {string[]} [candidates] - Model names to consider (default: all)
 * @returns {string|null}
 */
function getBestModel(candidates) {
  const pool = candidates || getAllModels();
  let best = null;
  let bestTier = -1;
  for (const m of pool) {
    const info = AGENT_REGISTRY[m];
    if (info && (TIER_ORDER[info.tier] || 0) > bestTier) {
      bestTier = TIER_ORDER[info.tier] || 0;
      best = m;
    }
  }
  return best;
}

module.exports = {
  AGENT_REGISTRY,
  TIER_ORDER,
  getAgentInfo,
  getModelsByTier,
  getModelsWithCapability,
  getAllModels,
  getCheapestModel,
  getBestModel,
};
