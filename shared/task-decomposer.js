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
async function decompose(taskDescription, { strategy = 'balanced', caller = 'task-decomposer' } = {}) {
  const prompt = DECOMPOSE_PROMPT.replace('{{task}}', taskDescription);

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

  const subtasks = JSON.parse(text.slice(start, end + 1));

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

  // Execute respecting dependencies
  for (let i = 0; i < subtasks.length; i++) {
    const st = subtasks[i];
    const taskId = taskIds[i];

    // Wait for dependencies
    for (const dep of st.depends_on) {
      if (dep >= 0 && dep < i && errors[dep]) {
        // Dependency failed, skip this task
        failTask(taskId, `Dependency subtask ${dep} failed`);
        errors[i] = `Dependency subtask ${dep} failed`;
        allSuccess = false;
        if (opts.onSubtaskError) opts.onSubtaskError(i, errors[i]);
        continue;
      }
    }
    if (errors[i]) continue;

    // Build context from dependency results
    let contextPrefix = '';
    for (const dep of st.depends_on) {
      if (dep >= 0 && dep < i && results[dep]) {
        contextPrefix += `Previous step (${subtasks[dep].description}):\n${results[dep]}\n\n`;
      }
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
      continue;
    }

    markRunning(claimed.id);

    try {
      const llmResult = await routedLlm(prompt, {
        strategy: st.strategy || opts.defaultStrategy || 'balanced',
        capability: st.capability,
        caller: opts.caller || `task-decomposer:${swarmId}:${i}`,
      });
      results[i] = llmResult.text;
      completeTask(claimed.id, llmResult.text);
      if (opts.onSubtaskComplete) opts.onSubtaskComplete(i, llmResult.text);
    } catch (err) {
      errors[i] = err.message;
      allSuccess = false;
      failTask(claimed.id, err.message);
      if (opts.onSubtaskError) opts.onSubtaskError(i, err.message);
    }
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
    } catch {
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
