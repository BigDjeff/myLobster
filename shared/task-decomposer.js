'use strict';

/**
 * task-decomposer.js — Gap 1: Orchestrator for automatic task decomposition.
 *
 * Takes a complex task description and uses an LLM to break it into subtasks,
 * then tracks them via the task-queue. Supports both sequential (pipeline)
 * and parallel (swarm) execution modes.
 *
 * Flow:
 *   1. Send the task description to an LLM with a decomposition prompt
 *   2. Parse the structured subtask list from the response
 *   3. Create a swarm in task-queue with the subtasks
 *   4. Optionally execute subtasks inline via routedLlm or spawn agents
 *   5. Synthesize results when all subtasks complete
 */

const { routedLlm } = require('./smart-router');
const { createSwarm, claimTask, markRunning, completeTask, failTask, getSwarmStatus, getSwarmResults, isSwarmComplete } = require('./task-queue');
const { getModelsWithCapability } = require('./agent-registry');

const DECOMPOSE_PROMPT = `You are a task decomposition engine. Break the following task into 2-6 concrete, independent subtasks.

Task:
---
{{task}}
---

Rules:
1. Each subtask must be self-contained and actionable
2. Order subtasks by dependency (earlier subtasks first)
3. For each subtask, specify:
   - description: what to do (1-2 sentences)
   - capability: the primary skill needed (one of: coding, reasoning, creative, classification, extraction, review, simple-reasoning, long-context, multimodal)
   - mode: "inline" for prompt-response tasks, "agent" for tasks needing file access/tools
   - depends_on: array of subtask indices this depends on (empty if independent)

Return ONLY a valid JSON array. Example:
[
  {"description": "Analyze the error logs to identify root cause", "capability": "reasoning", "mode": "inline", "depends_on": []},
  {"description": "Write a fix for the identified bug", "capability": "coding", "mode": "agent", "depends_on": [0]},
  {"description": "Write tests for the fix", "capability": "coding", "mode": "agent", "depends_on": [1]}
]`;

/**
 * Use an LLM to decompose a complex task into subtasks.
 * @param {string} taskDescription
 * @param {object} [opts]
 * @param {string} [opts.strategy='balanced'] - Strategy for the decomposition LLM call itself
 * @param {string} [opts.caller='task-decomposer']
 * @returns {Promise<Array<{description: string, capability: string, mode: string, depends_on: number[]}>>}
 */
async function decompose(taskDescription, { strategy = 'balanced', caller = 'task-decomposer', decomposePrompt } = {}) {
  const prompt = (decomposePrompt || DECOMPOSE_PROMPT).replace('{{task}}', taskDescription);

  const result = await routedLlm(prompt, {
    strategy,
    capability: 'reasoning',
    caller,
  });

  // Parse JSON from the response, tolerating markdown fences
  let text = result.text.trim();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    text = jsonMatch[1].trim();
  }

  // Find the first [ and last ] to extract JSON array
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('Decomposition failed: no JSON array in response');
  }

  let subtasks;
  try {
    subtasks = JSON.parse(text.slice(start, end + 1));
  } catch (parseErr) {
    const snippet = text.slice(start, Math.min(start + 200, end + 1));
    throw new Error(`Decomposition failed: invalid JSON — ${parseErr.message}. Raw text starts with: ${snippet}`);
  }

  // Validate structure
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    throw new Error('Decomposition failed: empty subtask list');
  }

  for (let i = 0; i < subtasks.length; i++) {
    const st = subtasks[i];
    if (!st.description) throw new Error(`Subtask ${i} missing description`);
    st.capability = st.capability || 'reasoning';
    st.mode = st.mode || 'inline';
    st.depends_on = st.depends_on || [];
  }

  // Validate dependency indices — no forward refs, no out-of-bounds, no circular
  for (let i = 0; i < subtasks.length; i++) {
    for (const dep of subtasks[i].depends_on) {
      if (typeof dep !== 'number' || !Number.isInteger(dep) || dep < 0 || dep >= subtasks.length) {
        throw new Error(`Subtask ${i} has invalid dependency index: ${dep} (must be integer 0-${subtasks.length - 1})`);
      }
      if (dep >= i) {
        throw new Error(`Subtask ${i} has forward/circular dependency on subtask ${dep} (depends_on indices must be < ${i})`);
      }
    }
  }

  return subtasks;
}

/**
 * Decompose a task and create a swarm in the task queue.
 * Returns the swarm ID and subtask details for downstream execution.
 *
 * @param {string} taskDescription
 * @param {object} [opts]
 * @param {string} [opts.swarmId] - Custom swarm ID
 * @param {string} [opts.defaultModel] - Default model for subtasks
 * @param {string} [opts.defaultStrategy='balanced'] - Default routing strategy
 * @param {string} [opts.caller='task-decomposer']
 * @returns {Promise<{swarmId: string, taskIds: string[], subtasks: object[]}>}
 */
async function decomposeAndQueue(taskDescription, opts = {}) {
  const subtasks = await decompose(taskDescription, {
    strategy: opts.defaultStrategy || 'balanced',
    caller: opts.caller || 'task-decomposer',
    decomposePrompt: opts.decomposePrompt,
  });

  // Build task entries for the queue
  const queueTasks = subtasks.map((st, i) => ({
    description: st.description,
    prompt: st.description, // can be expanded later
    model: opts.defaultModel || null,
    strategy: opts.defaultStrategy || 'balanced',
    mode: st.mode,
    metadata: {
      capability: st.capability,
      depends_on: st.depends_on,
      subtask_index: i,
    },
  }));

  const { swarmId, taskIds } = createSwarm({
    swarmId: opts.swarmId,
    tasks: queueTasks,
  });

  return { swarmId, taskIds, subtasks };
}

/**
 * Execute a decomposed swarm inline (all tasks run in-process via routedLlm).
 * Respects dependency ordering: tasks with depends_on wait for their deps to complete.
 *
 * @param {string} taskDescription - The original task
 * @param {object} [opts]
 * @param {string} [opts.swarmId]
 * @param {string} [opts.defaultStrategy='balanced']
 * @param {string} [opts.caller='task-decomposer']
 * @param {boolean} [opts.synthesize=true] - Run a synthesis step after all subtasks
 * @param {string} [opts.synthesizePrompt] - Custom synthesis prompt
 * @param {function} [opts.onSubtaskStart] - Callback(subtaskIndex, description)
 * @param {function} [opts.onSubtaskComplete] - Callback(subtaskIndex, result)
 * @param {function} [opts.onSubtaskError] - Callback(subtaskIndex, error)
 * @returns {Promise<{swarmId: string, success: boolean, results: object[], synthesis: string|null}>}
 */
async function executeDecomposed(taskDescription, opts = {}) {
  const { swarmId, taskIds, subtasks } = await decomposeAndQueue(taskDescription, opts);

  const results = new Array(subtasks.length).fill(null);
  const errors = new Array(subtasks.length).fill(null);
  let allSuccess = true;

  // Build topological levels for parallel execution (2A)
  const maxContextChars = opts.maxContextChars != null ? opts.maxContextChars : 4000;
  const levels = [];
  const taskLevel = new Array(subtasks.length).fill(-1);
  const remaining = new Set(subtasks.map((_, i) => i));

  while (remaining.size > 0) {
    const level = [];
    for (const i of remaining) {
      const deps = subtasks[i].depends_on;
      if (deps.every(d => taskLevel[d] >= 0)) {
        level.push(i);
      }
    }
    if (level.length === 0) {
      for (const i of remaining) {
        failTask(taskIds[i], 'Unresolvable dependency cycle');
        errors[i] = 'Unresolvable dependency cycle';
        allSuccess = false;
      }
      break;
    }
    for (const i of level) {
      taskLevel[i] = levels.length;
      remaining.delete(i);
    }
    levels.push(level);
  }

  // Execute level by level with Promise.all — O(depth) instead of O(n)
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : 2;

  for (const level of levels) {
    await Promise.all(level.map(async (i) => {
      const st = subtasks[i];
      const taskId = taskIds[i];

      // Check if any dependency failed
      for (const dep of st.depends_on) {
        if (errors[dep]) {
          failTask(taskId, `Dependency subtask ${dep} failed`);
          errors[i] = `Dependency subtask ${dep} failed`;
          allSuccess = false;
          if (opts.onSubtaskError) opts.onSubtaskError(i, errors[i]);
          return;
        }
      }

      // Build context from dependency results (bounded — 2B)
      let contextPrefix = '';
      for (const dep of st.depends_on) {
        if (results[dep]) {
          const depResult = results[dep].length > 1000
            ? results[dep].slice(0, 1000) + '...(truncated)'
            : results[dep];
          contextPrefix += `Previous step (${subtasks[dep].description}):\n${depResult}\n\n`;
        }
      }
      if (contextPrefix.length > maxContextChars) {
        contextPrefix = contextPrefix.slice(0, maxContextChars) + '...(context truncated)';
      }

      const prompt = contextPrefix
        ? `Context from previous steps:\n${contextPrefix}\nNow: ${st.description}`
        : st.description;

      if (opts.onSubtaskStart) opts.onSubtaskStart(i, st.description);

      // Claim and execute
      const claimed = claimTask(swarmId, `decomposer-${i}`);
      if (!claimed) {
        errors[i] = 'Failed to claim task';
        allSuccess = false;
        if (opts.onSubtaskError) opts.onSubtaskError(i, errors[i]);
        return;
      }

      markRunning(claimed.id);

      let lastErr = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const llmResult = await routedLlm(prompt, {
            strategy: st.strategy || opts.defaultStrategy || 'balanced',
            capability: st.capability,
            caller: opts.caller || `task-decomposer:${swarmId}:${i}`,
          });
          results[i] = llmResult.text;
          completeTask(claimed.id, llmResult.text);
          if (opts.onSubtaskComplete) opts.onSubtaskComplete(i, llmResult.text);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const isTransient = /timeout|ETIMEDOUT|rate.?limit|429|503|ECONNRESET/i.test(err.message);
          if (isTransient && attempt < maxRetries) {
            const delayMs = 1000 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delayMs));
            continue;
          }
          break;
        }
      }
      if (lastErr) {
        errors[i] = lastErr.message;
        allSuccess = false;
        failTask(claimed.id, lastErr.message);
        if (opts.onSubtaskError) opts.onSubtaskError(i, lastErr.message);
      }
    }));
  }

  // Synthesis step
  let synthesis = null;
  if (opts.synthesize !== false && results.some(r => r !== null)) {
    const resultsText = results
      .map((r, i) => r ? `[${subtasks[i].description}]: ${r}` : null)
      .filter(Boolean)
      .join('\n\n---\n\n');

    const synthesizePrompt = opts.synthesizePrompt
      ? opts.synthesizePrompt.replace('{{results}}', resultsText)
      : `Synthesize the following subtask results into a coherent final answer:\n\n${resultsText}`;

    try {
      const synthResult = await routedLlm(synthesizePrompt, {
        strategy: 'balanced',
        caller: opts.caller || `task-decomposer:${swarmId}:synthesis`,
      });
      synthesis = synthResult.text;
    } catch (err) {
      console.error(`[task-decomposer] Synthesis failed for swarm ${swarmId}: ${err.message}`);
      synthesis = resultsText; // fallback: concatenate results
    }
  }

  return {
    swarmId,
    success: allSuccess,
    results: getSwarmResults(swarmId),
    synthesis,
  };
}

module.exports = {
  decompose,
  decomposeAndQueue,
  executeDecomposed,
};
