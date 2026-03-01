'use strict';

/**
 * smart-router.js — Strategy-based model selection wrapping llm-router.js.
 *
 * Strategies:
 *   - cheapest  — lowest cost model (from llm_calls.db stats or agent-registry fallback)
 *   - fastest   — lowest latency model (from llm_calls.db stats or agent-registry fallback)
 *   - best      — highest-tier model (from agent-registry)
 *   - balanced  — best cost/latency ratio with high success rate
 *   - specific  — pass-through (same as calling runLlm directly)
 *
 * The existing runLlm() is untouched. New callers import routedLlm() when they
 * want strategy-based routing.
 */

const { runLlm } = require('./llm-router');
const { getDb: getLlmDb } = require('./interaction-store');
const {
  getAgentInfo,
  getModelsWithCapability,
  getCheapestModel,
  getFastestModel,
  getBestModel,
  getAllModels,
} = require('./agent-registry');

// Configurable router defaults (3B, 3F)
const ROUTER_DEFAULTS = {
  minSuccessRate: 0.8,
  balancedMinSuccessRate: 0.9,
  minSampleSize: 3,
  statsHoursBack: 24,
  fallbacks: {
    cheapest: 'claude-haiku-4-5',
    fastest: 'claude-haiku-4-5',
    best: 'claude-opus-4-5',
    balanced: 'claude-sonnet-4-5',
  },
};

let _routerConfig = { ...ROUTER_DEFAULTS, fallbacks: { ...ROUTER_DEFAULTS.fallbacks } };

// Backward-compatible snapshot
const STRATEGY_FALLBACKS = { ...ROUTER_DEFAULTS.fallbacks };

/**
 * Override router configuration values.
 * @param {object} overrides - Partial config to merge
 */
function configureRouter(overrides) {
  if (overrides.fallbacks) {
    _routerConfig.fallbacks = { ..._routerConfig.fallbacks, ...overrides.fallbacks };
    delete overrides.fallbacks;
  }
  Object.assign(_routerConfig, overrides);
}

/**
 * Query per-model stats from llm_calls.db for the last N hours.
 * @param {number} [hoursBack=24]
 * @returns {Array<{model: string, call_count: number, avg_latency_ms: number, success_rate: number, avg_cost: number}>}
 */
function getModelStats(hoursBack) {
  const hours = hoursBack != null ? hoursBack : _routerConfig.statsHoursBack;
  const minSamples = _routerConfig.minSampleSize;
  try {
    const db = getLlmDb();
    return db.prepare(`
      SELECT model,
             COUNT(*) as call_count,
             AVG(duration_ms) as avg_latency_ms,
             AVG(CASE WHEN ok=1 THEN 1.0 ELSE 0.0 END) as success_rate,
             AVG(cost_estimate) as avg_cost
      FROM llm_calls
      WHERE timestamp > datetime('now', ?)
      GROUP BY model
      HAVING call_count >= ?
    `).all(`-${hours} hours`, minSamples);
  } catch {
    return [];
  }
}

/**
 * Resolve a model based on a routing strategy.
 * @param {string} strategy - One of: cheapest, fastest, best, balanced, specific
 * @param {object} [opts]
 * @param {string} [opts.capability] - Required capability (filters candidate pool)
 * @param {string} [opts.model] - Explicit model (used when strategy=specific)
 * @returns {string} Resolved model name
 */
function resolveModel(strategy, opts = {}) {
  const { capability, model } = opts;

  // specific: pass-through
  if (strategy === 'specific' || (!strategy && model)) {
    return model || 'claude-sonnet-4-5';
  }

  // Build candidate pool
  let candidates = capability
    ? getModelsWithCapability(capability)
    : getAllModels();

  if (candidates.length === 0) {
    candidates = getAllModels();
  }

  const stats = getModelStats();
  const statsByModel = {};
  for (const s of stats) {
    statsByModel[s.model] = s;
  }

  // Filter candidates to those with decent success rates (for stats-based strategies)
  const reliableCandidates = candidates.filter(m => {
    const s = statsByModel[m];
    return s && s.success_rate >= _routerConfig.minSuccessRate;
  });

  switch (strategy) {
    case 'cheapest': {
      // Stats-based: lowest avg_cost with acceptable success rate
      if (reliableCandidates.length > 0) {
        let best = reliableCandidates[0];
        let bestCost = statsByModel[best].avg_cost;
        for (const m of reliableCandidates) {
          if (statsByModel[m].avg_cost < bestCost) {
            bestCost = statsByModel[m].avg_cost;
            best = m;
          }
        }
        return best;
      }
      // Fallback: use registry costTier
      return getCheapestModel(candidates) || _routerConfig.fallbacks.cheapest;
    }

    case 'fastest': {
      // Stats-based: lowest avg_latency_ms
      if (reliableCandidates.length > 0) {
        let best = reliableCandidates[0];
        let bestLatency = statsByModel[best].avg_latency_ms;
        for (const m of reliableCandidates) {
          if (statsByModel[m].avg_latency_ms < bestLatency) {
            bestLatency = statsByModel[m].avg_latency_ms;
            best = m;
          }
        }
        return best;
      }
      return getFastestModel(candidates) || _routerConfig.fallbacks.fastest;
    }

    case 'best': {
      // Static: highest tier from registry
      return getBestModel(candidates) || _routerConfig.fallbacks.best;
    }

    case 'balanced': {
      // Stats-based: best (1/cost * 1/latency) ratio with success_rate >= 0.9
      const highReliable = candidates.filter(m => {
        const s = statsByModel[m];
        return s && s.success_rate >= _routerConfig.balancedMinSuccessRate;
      });

      if (highReliable.length > 0) {
        let best = highReliable[0];
        let bestScore = -Infinity;
        for (const m of highReliable) {
          const s = statsByModel[m];
          const cost = s.avg_cost || 0.001;
          const latency = s.avg_latency_ms || 1;
          const score = 1 / (cost * latency);
          if (score > bestScore) {
            bestScore = score;
            best = m;
          }
        }
        return best;
      }
      // Fallback: sonnet is the canonical balanced choice
      return candidates.includes('claude-sonnet-4-5')
        ? 'claude-sonnet-4-5'
        : _routerConfig.fallbacks.balanced;
    }

    default:
      return model || _routerConfig.fallbacks.balanced;
  }
}

/**
 * Strategy-routed LLM call. Wraps runLlm() with automatic model selection.
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.strategy='balanced'] - Routing strategy
 * @param {string} [opts.capability] - Required model capability
 * @param {string} [opts.model] - Explicit model (overrides strategy)
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.caller]
 * @param {boolean} [opts.skipLog]
 * @returns {Promise<{ text: string, durationMs: number, provider: string, resolvedModel: string }>}
 */
async function routedLlm(prompt, {
  strategy = 'balanced',
  capability,
  model,
  timeoutMs,
  caller = 'smart-router',
  skipLog = false,
} = {}) {
  const resolvedModel = model || resolveModel(strategy, { capability, model });

  if (!skipLog) {
    console.error(`[smart-router] strategy=${strategy} capability=${capability || 'any'} → model=${resolvedModel}`);
  }

  // Use the resolved model's default timeout if not specified
  const info = getAgentInfo(resolvedModel);
  const timeout = timeoutMs || (info ? info.defaultTimeoutMs : 60_000);

  const result = await runLlm(prompt, {
    model: resolvedModel,
    timeoutMs: timeout,
    caller,
    skipLog,
  });

  return { ...result, resolvedModel };
}

module.exports = { routedLlm, resolveModel, getModelStats, configureRouter, ROUTER_DEFAULTS, STRATEGY_FALLBACKS };
