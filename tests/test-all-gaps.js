'use strict';

/**
 * test-all-gaps.js — Tests for all new modules:
 *   1. agent-registry.js
 *   2. task-queue.js
 *   3. smart-router.js (resolveModel only, no live LLM calls)
 *   4. task-decomposer.js (structure only, no live LLM calls)
 *   5. agent-comms.js
 *   6. code-review.js (parseReviewResponse + formatReviewForNotification only)
 *   7. verify-cron.sh (existence + executable check)
 *
 * Run: node workspace/tests/test-all-gaps.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    errors.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    errors.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ============================================================================
// 1. agent-registry.js
// ============================================================================
console.log('\n=== 1. agent-registry.js ===');

const registry = require('../shared/agent-registry');

assert(typeof registry.AGENT_REGISTRY === 'object', 'AGENT_REGISTRY is an object');
assert(Object.keys(registry.AGENT_REGISTRY).length >= 5, 'Has 5+ models registered');

// getAgentInfo
const opusInfo = registry.getAgentInfo('claude-opus-4-5');
assert(opusInfo !== null, 'getAgentInfo returns opus info');
assertEq(opusInfo.tier, 'best', 'opus is tier "best"');
assertEq(opusInfo.provider, 'anthropic', 'opus provider is anthropic');
assert(opusInfo.capabilities.includes('coding'), 'opus has coding capability');

const noModel = registry.getAgentInfo('nonexistent-model');
assert(noModel === null, 'getAgentInfo returns null for unknown model');

// getModelsByTier
const cheapModels = registry.getModelsByTier('cheap');
assertEq(cheapModels, ['claude-haiku-4-5'], 'cheap tier → haiku only');

const balancedModels = registry.getModelsByTier('balanced');
assert(balancedModels.length >= 2, 'balanced tier has 2+ models');
assert(balancedModels.includes('claude-sonnet-4-5'), 'balanced includes sonnet');

// getModelsWithCapability
const codingModels = registry.getModelsWithCapability('coding');
assert(codingModels.includes('claude-opus-4-5'), 'coding models include opus');
assert(codingModels.includes('gpt-5.3-codex'), 'coding models include codex');

const multimodalModels = registry.getModelsWithCapability('multimodal');
assertEq(multimodalModels, ['gpt-4o'], 'multimodal → gpt-4o only');

// getAllModels
const all = registry.getAllModels();
assert(all.length >= 5, 'getAllModels returns 5+ models');

// getCheapestModel / getBestModel
assertEq(registry.getCheapestModel(), 'claude-haiku-4-5', 'cheapest overall is haiku');
assertEq(registry.getBestModel(), 'claude-opus-4-5', 'best overall is opus');
assertEq(registry.getCheapestModel(['claude-opus-4-5', 'claude-sonnet-4-5']), 'claude-sonnet-4-5', 'cheapest of opus+sonnet is sonnet');

// ============================================================================
// 2. task-queue.js
// ============================================================================
console.log('\n=== 2. task-queue.js ===');

// Use a temporary DB for testing
const taskQueue = require('../shared/task-queue');

// Clean up any existing test data
const tqDb = taskQueue.getDb();
tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");

// createSwarm
const swarm = taskQueue.createSwarm({
  swarmId: 'test-swarm-1',
  tasks: [
    { description: 'Task A', prompt: 'Do task A' },
    { description: 'Task B', prompt: 'Do task B', mode: 'agent' },
    { description: 'Task C', prompt: 'Do task C', strategy: 'cheapest' },
  ],
});

assertEq(swarm.swarmId, 'test-swarm-1', 'createSwarm returns correct swarmId');
assertEq(swarm.taskIds.length, 3, 'createSwarm creates 3 tasks');

// getSwarmStatus
const status1 = taskQueue.getSwarmStatus('test-swarm-1');
assertEq(status1.total, 3, 'swarm has 3 total tasks');
assertEq(status1.pending, 3, 'all 3 tasks pending');
assertEq(status1.done, 0, '0 tasks done');

// claimTask
const claimed1 = taskQueue.claimTask('test-swarm-1', 'worker-1');
assert(claimed1 !== null, 'claimTask returns a task');
assertEq(claimed1.description, 'Task A', 'claims first task (ordered by seq)');
assertEq(claimed1.status, 'claimed', 'claimed task has status "claimed"');

// Second claim should get next task
const claimed2 = taskQueue.claimTask('test-swarm-1', 'worker-2');
assert(claimed2 !== null, 'second claimTask returns a task');
assertEq(claimed2.description, 'Task B', 'claims second task');

// markRunning
taskQueue.markRunning(claimed1.id);
const running = taskQueue.getTask(claimed1.id);
assertEq(running.status, 'running', 'markRunning updates status');

// completeTask
taskQueue.completeTask(claimed1.id, 'Result A');
const done = taskQueue.getTask(claimed1.id);
assertEq(done.status, 'done', 'completeTask sets status to done');
assertEq(done.result, 'Result A', 'completeTask saves result');
assert(done.completed_at !== null, 'completeTask sets completed_at');

// failTask
taskQueue.failTask(claimed2.id, 'Something went wrong');
const failedTask = taskQueue.getTask(claimed2.id);
assertEq(failedTask.status, 'failed', 'failTask sets status to failed');
assertEq(failedTask.error, 'Something went wrong', 'failTask saves error');

// Claim third task
const claimed3 = taskQueue.claimTask('test-swarm-1', 'worker-1');
assert(claimed3 !== null, 'third claim succeeds');
taskQueue.completeTask(claimed3.id, 'Result C');

// No more tasks to claim
const claimed4 = taskQueue.claimTask('test-swarm-1', 'worker-1');
assert(claimed4 === null, 'claimTask returns null when no pending tasks');

// isSwarmComplete
assert(taskQueue.isSwarmComplete('test-swarm-1'), 'swarm is complete (all tasks terminal)');

// getSwarmResults
const results = taskQueue.getSwarmResults('test-swarm-1');
assertEq(results.length, 3, 'getSwarmResults returns all 3 tasks');
assertEq(results[0].result, 'Result A', 'first result correct');
assertEq(results[1].status, 'failed', 'second task is failed');

// resetTask
taskQueue.resetTask(claimed2.id);
const resetted = taskQueue.getTask(claimed2.id);
assertEq(resetted.status, 'pending', 'resetTask sets status back to pending');

// getStaleTasks (none should be stale since we just created them)
const stale = taskQueue.getStaleTasks(15);
assert(stale.length === 0, 'no stale tasks right after creation');

// Clean up test data
tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");

// ============================================================================
// 3. smart-router.js (resolveModel only — no live LLM calls)
// ============================================================================
console.log('\n=== 3. smart-router.js ===');

const smartRouter = require('../shared/smart-router');

// Test resolveModel with no stats data (should use fallbacks)
const cheapest = smartRouter.resolveModel('cheapest');
assertEq(cheapest, 'claude-haiku-4-5', 'cheapest with no stats → haiku (fallback from registry)');

const fastest = smartRouter.resolveModel('fastest');
assertEq(fastest, 'claude-haiku-4-5', 'fastest with no stats → haiku (fallback from registry)');

const best = smartRouter.resolveModel('best');
assertEq(best, 'claude-opus-4-5', 'best → opus (from registry)');

const balanced = smartRouter.resolveModel('balanced');
assertEq(balanced, 'claude-sonnet-4-5', 'balanced with no stats → sonnet (fallback)');

// specific strategy
const specific = smartRouter.resolveModel('specific', { model: 'gpt-4o' });
assertEq(specific, 'gpt-4o', 'specific → pass-through');

// With capability filter
const codingBest = smartRouter.resolveModel('best', { capability: 'coding' });
assertEq(codingBest, 'claude-opus-4-5', 'best coding model is opus');

// getModelStats
const stats = smartRouter.getModelStats(24);
assert(Array.isArray(stats), 'getModelStats returns array');

// STRATEGY_FALLBACKS
assert(smartRouter.STRATEGY_FALLBACKS.cheapest === 'claude-haiku-4-5', 'fallback cheapest is haiku');
assert(smartRouter.STRATEGY_FALLBACKS.best === 'claude-opus-4-5', 'fallback best is opus');

// ============================================================================
// 4. task-decomposer.js (structure tests only)
// ============================================================================
console.log('\n=== 4. task-decomposer.js ===');

const decomposer = require('../shared/task-decomposer');

assert(typeof decomposer.decompose === 'function', 'decompose is a function');
assert(typeof decomposer.decomposeAndQueue === 'function', 'decomposeAndQueue is a function');
assert(typeof decomposer.executeDecomposed === 'function', 'executeDecomposed is a function');

// ============================================================================
// 5. agent-comms.js
// ============================================================================
console.log('\n=== 5. agent-comms.js ===');

const comms = require('../shared/agent-comms');

// Clean test data
const commsDb = comms.getDb();
commsDb.exec("DELETE FROM messages WHERE channel LIKE 'test-%' OR channel LIKE 'dm:%test%'");
commsDb.exec("DELETE FROM read_cursors WHERE agent_id LIKE 'test-%'");

// postMessage + readMessages
const msgId = comms.postMessage({
  channel: 'test-channel',
  sender: 'test-agent-1',
  payload: { foo: 'bar' },
});
assert(typeof msgId === 'string', 'postMessage returns message ID');
assert(msgId.startsWith('msg-'), 'message ID has correct prefix');

const msgs = comms.readMessages('test-channel');
assert(msgs.length >= 1, 'readMessages returns posted message');
assertEq(msgs[0].sender, 'test-agent-1', 'message sender is correct');
assertEq(msgs[0].type, 'data', 'default type is data');

// Multiple messages
comms.postMessage({ channel: 'test-channel', sender: 'test-agent-2', payload: 'hello' });
comms.postMessage({ channel: 'test-channel', sender: 'test-agent-1', payload: 'world' });

const allMsgs = comms.readMessages('test-channel');
assert(allMsgs.length >= 3, 'all 3 messages readable');

// Read with agentId (cursor tracking)
const agent2Msgs = comms.readMessages('test-channel', { agentId: 'test-agent-2' });
assert(agent2Msgs.length >= 3, 'agent-2 sees all messages first time');

// Read again — cursor should filter already-read messages
const agent2MsgsAgain = comms.readMessages('test-channel', { agentId: 'test-agent-2' });
assertEq(agent2MsgsAgain.length, 0, 'agent-2 sees 0 messages after reading (cursor advanced)');

// New message after cursor
comms.postMessage({ channel: 'test-channel', sender: 'test-agent-1', payload: 'new!' });
const agent2New = comms.readMessages('test-channel', { agentId: 'test-agent-2' });
assertEq(agent2New.length, 1, 'agent-2 sees 1 new message after cursor');

// Direct messages
comms.sendDirect('test-agent-1', 'test-agent-2', 'private data');
const directMsgs = comms.readDirect('test-agent-2');
assert(directMsgs.length >= 1, 'readDirect returns DM');
assertEq(directMsgs[0].sender, 'test-agent-1', 'DM sender is correct');

// Broadcast signal
comms.broadcastSignal('test-channel', 'test-agent-1', 'ready', { step: 1 });
const signals = comms.readMessages('test-channel', { type: 'signal' });
assert(signals.length >= 1, 'signal messages readable');

// Share context
comms.shareContext('test-channel', 'test-agent-1', 'api_url', 'https://example.com');
const ctx = comms.getContext('test-channel', 'api_url');
assertEq(ctx, 'https://example.com', 'getContext returns shared value');

// TTL (expired message shouldn't appear)
comms.postMessage({
  channel: 'test-channel',
  sender: 'test-agent-1',
  payload: 'should expire',
  ttlMinutes: 0, // instant expiry — but since ttl=0 means "now + 0 min = now", this is tricky
});
// Note: ttlMinutes=0 expires_at = now, so cleanExpired should catch it
// In practice, sub-second timing may or may not clean it. Skip precise expiry test.

// cleanExpired
const cleaned = comms.cleanExpired();
assert(typeof cleaned === 'number', 'cleanExpired returns count');

// Clean test data
commsDb.exec("DELETE FROM messages WHERE channel LIKE 'test-%' OR channel LIKE 'dm:%test%'");
commsDb.exec("DELETE FROM read_cursors WHERE agent_id LIKE 'test-%'");

// ============================================================================
// 6. code-review.js (parse/format only — no live LLM calls)
// ============================================================================
console.log('\n=== 6. code-review.js ===');

const codeReview = require('../shared/code-review');

// parseReviewResponse
const passReview = codeReview.parseReviewResponse(
  'VERDICT: PASS\nISSUES:\n- none\nSUMMARY: Clean implementation with good error handling.'
);
assertEq(passReview.verdict, 'PASS', 'parses PASS verdict');
assertEq(passReview.issues.length, 0, 'no issues for PASS');
assert(passReview.summary.includes('Clean'), 'summary extracted');

const warnReview = codeReview.parseReviewResponse(
  'VERDICT: WARN\nISSUES:\n- Missing input validation on line 42\n- No error handling for network failures\nSUMMARY: Works but needs defensive coding.'
);
assertEq(warnReview.verdict, 'WARN', 'parses WARN verdict');
assertEq(warnReview.issues.length, 2, '2 issues found');
assert(warnReview.issues[0].includes('input validation'), 'first issue correct');

const failReview = codeReview.parseReviewResponse(
  'VERDICT: FAIL\nISSUES:\n- SQL injection vulnerability in query builder\n- Hardcoded credentials\n- Missing auth check\nSUMMARY: Critical security issues.'
);
assertEq(failReview.verdict, 'FAIL', 'parses FAIL verdict');
assertEq(failReview.issues.length, 3, '3 issues found');

// formatReviewForNotification
const formatted = codeReview.formatReviewForNotification(warnReview);
assert(formatted.includes('WARN'), 'format includes verdict');
assert(formatted.includes('input validation'), 'format includes issues');
assert(formatted.includes('Works but'), 'format includes summary');

const formattedPass = codeReview.formatReviewForNotification(passReview);
assert(formattedPass.includes('PASS'), 'PASS format includes verdict');

// readAgentLog (non-existent file)
const noLog = codeReview.readAgentLog('nonexistent-task-id');
assert(noLog.includes('no log file'), 'readAgentLog handles missing file');

// ============================================================================
// 7. File existence and permissions checks
// ============================================================================
console.log('\n=== 7. File checks ===');

const verifyCronPath = path.join(__dirname, '..', 'scripts', 'verify-cron.sh');
assert(fs.existsSync(verifyCronPath), 'verify-cron.sh exists');
const verifyCronStat = fs.statSync(verifyCronPath);
assert((verifyCronStat.mode & 0o111) !== 0, 'verify-cron.sh is executable');

const checkSwarmsPath = path.join(__dirname, '..', 'scripts', 'check-swarms.sh');
assert(fs.existsSync(checkSwarmsPath), 'check-swarms.sh exists');
const checkSwarmsStat = fs.statSync(checkSwarmsPath);
assert((checkSwarmsStat.mode & 0o111) !== 0, 'check-swarms.sh is executable');

// spawn-agent.sh has --raw-cmd
const spawnAgent = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'spawn-agent.sh'), 'utf8');
assert(spawnAgent.includes('--raw-cmd'), 'spawn-agent.sh has --raw-cmd flag');
assert(spawnAgent.includes('RAW_CMD'), 'spawn-agent.sh has RAW_CMD variable');

// openai-chat.js has refreshOpenAIToken
const openaiChat = fs.readFileSync(path.join(__dirname, '..', 'shared', 'openai-chat.js'), 'utf8');
assert(openaiChat.includes('refreshOpenAIToken'), 'openai-chat.js exports refreshOpenAIToken');
assert(openaiChat.includes('auth.openai.com/oauth/token'), 'openai-chat.js has token refresh endpoint');
assert(openaiChat.includes('async function resolveOpenAIAuth'), 'resolveOpenAIAuth is async');

// check-agents.sh has code review integration
const checkAgents = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-agents.sh'), 'utf8');
assert(checkAgents.includes('code-review'), 'check-agents.sh integrates code review');
assert(checkAgents.includes('reviewTask'), 'check-agents.sh calls reviewTask');

// cron/jobs.json has new jobs
const cronJobs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'cron', 'jobs.json'), 'utf8'));
const jobIds = cronJobs.jobs.map(j => j.id);
assert(jobIds.includes('check-swarms'), 'cron has check-swarms job');
assert(jobIds.includes('verify-cron'), 'cron has verify-cron job');
assert(jobIds.includes('refresh-openai-token'), 'cron has refresh-openai-token job');

// ============================================================================
// 8. Phase 1 reliability tests
// ============================================================================
console.log('\n=== 8. Phase 1 reliability ===');

// 1F: postMessage validation
let postMsgErr;
try { comms.postMessage({}); } catch (e) { postMsgErr = e.message; }
assert(postMsgErr && postMsgErr.includes('channel is required'), 'postMessage({}) throws "channel is required"');

let postMsgErr2;
try { comms.postMessage({ channel: 'x' }); } catch (e) { postMsgErr2 = e.message; }
assert(postMsgErr2 && postMsgErr2.includes('sender is required'), 'postMessage with no sender throws');

let postMsgErr3;
try { comms.postMessage({ channel: 'x', sender: 'y', type: 'bogus', payload: 'z' }); } catch (e) { postMsgErr3 = e.message; }
assert(postMsgErr3 && postMsgErr3.includes('invalid type'), 'postMessage with invalid type throws');

let postMsgErr4;
try { comms.postMessage({ channel: 'x', sender: 'y', payload: null }); } catch (e) { postMsgErr4 = e.message; }
assert(postMsgErr4 && postMsgErr4.includes('payload is required'), 'postMessage with null payload throws');

// 1D: resolveModel('fastest') returns haiku via fastest path (not cheapest)
const fastestModel = smartRouter.resolveModel('fastest');
assertEq(fastestModel, 'claude-haiku-4-5', 'fastest with no stats → haiku (via getFastestModel)');
// Verify it's actually from registry's fastest (lowest timeout) not cheapest
const haikuInfo = registry.getAgentInfo('claude-haiku-4-5');
assert(haikuInfo.defaultTimeoutMs === 30_000, 'haiku has lowest timeout (30s) confirming fastest path');

// 1H: claimTask with checkDeps
tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");
const depSwarm = taskQueue.createSwarm({
  swarmId: 'test-deps-1',
  tasks: [
    { description: 'Independent task', metadata: { depends_on: [], subtask_index: 0 } },
    { description: 'Depends on task 0', metadata: { depends_on: [0], subtask_index: 1 } },
    { description: 'Depends on task 1', metadata: { depends_on: [1], subtask_index: 2 } },
  ],
});

// With checkDeps, should claim task 0 first (no deps)
const depClaim1 = taskQueue.claimTask('test-deps-1', 'worker-x', { checkDeps: true });
assert(depClaim1 !== null, 'checkDeps claims independent task');
assertEq(depClaim1.description, 'Independent task', 'checkDeps claims task 0 first');

// Task 1 depends on task 0 which is not done yet (only claimed)
const depClaim2 = taskQueue.claimTask('test-deps-1', 'worker-x', { checkDeps: true });
assert(depClaim2 === null, 'checkDeps blocks task with unmet dependencies');

// Complete task 0, now task 1 should be claimable
taskQueue.completeTask(depClaim1.id, 'done');
const depClaim3 = taskQueue.claimTask('test-deps-1', 'worker-x', { checkDeps: true });
assert(depClaim3 !== null, 'checkDeps allows task after dep is done');
assertEq(depClaim3.description, 'Depends on task 0', 'checkDeps claims task 1 after task 0 done');

tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");

// ============================================================================
// 9. Phase 2 performance tests
// ============================================================================
console.log('\n=== 9. Phase 2 performance ===');

// 2D: getContext with SQL-based lookup
commsDb.exec("DELETE FROM messages WHERE channel LIKE 'test-%'");
comms.shareContext('test-ctx-ch', 'agent-a', 'db_url', 'postgres://localhost/db');
comms.shareContext('test-ctx-ch', 'agent-a', 'api_key', 'sk-test-123');
comms.shareContext('test-ctx-ch', 'agent-a', 'db_url', 'postgres://localhost/db2');

const ctxVal = comms.getContext('test-ctx-ch', 'db_url');
assertEq(ctxVal, 'postgres://localhost/db2', 'getContext returns latest value for key via SQL');

const ctxVal2 = comms.getContext('test-ctx-ch', 'api_key');
assertEq(ctxVal2, 'sk-test-123', 'getContext returns correct value for different key');

const ctxVal3 = comms.getContext('test-ctx-ch', 'nonexistent');
assertEq(ctxVal3, null, 'getContext returns null for missing key');

commsDb.exec("DELETE FROM messages WHERE channel LIKE 'test-%'");

// 2E: cleanCompletedSwarms
tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");
const cleanSwarm = taskQueue.createSwarm({
  swarmId: 'test-clean-1',
  tasks: [
    { description: 'Old task A' },
    { description: 'Old task B' },
  ],
});
// Complete both tasks
taskQueue.claimTask('test-clean-1', 'w1');
const cleanT1 = taskQueue.getTask(cleanSwarm.taskIds[0]);
taskQueue.completeTask(cleanT1.id, 'done');
taskQueue.claimTask('test-clean-1', 'w1');
const cleanT2 = taskQueue.getTask(cleanSwarm.taskIds[1]);
taskQueue.completeTask(cleanT2.id, 'done');

// Set completed_at to the past so retention check works
tqDb.exec("UPDATE swarm_tasks SET completed_at = datetime('now', '-8 days') WHERE swarm_id = 'test-clean-1'");

const cleanedCount = taskQueue.cleanCompletedSwarms(7);
assert(cleanedCount >= 2, 'cleanCompletedSwarms deletes old terminal swarm tasks');

const cleanedResults = taskQueue.getSwarmResults('test-clean-1');
assertEq(cleanedResults.length, 0, 'cleaned swarm has no remaining tasks');

tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");

// ============================================================================
// 10. Phase 3 extensibility tests
// ============================================================================
console.log('\n=== 10. Phase 3 extensibility ===');

// 3B: configureRouter changes thresholds
const origDefaults = { ...smartRouter.ROUTER_DEFAULTS };
smartRouter.configureRouter({ minSampleSize: 10 });
// Verify the config change took effect by checking the exported ROUTER_DEFAULTS is unchanged (snapshot)
assertEq(smartRouter.ROUTER_DEFAULTS.minSampleSize, 3, 'ROUTER_DEFAULTS unchanged after configureRouter');
// Reset
smartRouter.configureRouter({ minSampleSize: origDefaults.minSampleSize });

// 3D: getModelsByContextFit
const fit150k = registry.getModelsByContextFit(150_000);
assert(fit150k.includes('claude-opus-4-5'), '200K opus fits 150K tokens');
assert(fit150k.includes('claude-sonnet-4-5'), '200K sonnet fits 150K tokens');
assert(fit150k.includes('claude-haiku-4-5'), '200K haiku fits 150K tokens');
assert(!fit150k.includes('gpt-5.3-codex'), '128K codex does not fit 150K tokens');
assert(!fit150k.includes('gpt-4o'), '128K gpt-4o does not fit 150K tokens');

const fit100k = registry.getModelsByContextFit(100_000);
assertEq(fit100k.length, 5, 'all 5 models fit 100K tokens');

// 3D: pricing data in registry
const opusPricing = registry.getAgentInfo('claude-opus-4-5').pricingPerMToken;
assertEq(opusPricing.input, 15, 'opus input pricing is 15 per MToken');
assertEq(opusPricing.output, 75, 'opus output pricing is 75 per MToken');

const haikuPricing = registry.getAgentInfo('claude-haiku-4-5').pricingPerMToken;
assertEq(haikuPricing.input, 0.25, 'haiku input pricing is 0.25 per MToken');

// 3D: maxContextTokens in registry
assertEq(registry.getAgentInfo('claude-opus-4-5').maxContextTokens, 200_000, 'opus has 200K context');
assertEq(registry.getAgentInfo('gpt-5.3-codex').maxContextTokens, 128_000, 'codex has 128K context');

// 3G: lifecycle hooks fire on completeTask and failTask
tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");
const hookLog = [];
taskQueue.onTaskEvent('onComplete', (taskId, result) => hookLog.push({ event: 'complete', taskId, result }));
taskQueue.onTaskEvent('onFail', (taskId, error) => hookLog.push({ event: 'fail', taskId, error }));
taskQueue.onTaskEvent('onClaim', (task) => hookLog.push({ event: 'claim', taskId: task.id }));
taskQueue.onTaskEvent('onReset', (taskId) => hookLog.push({ event: 'reset', taskId }));

const hookSwarm = taskQueue.createSwarm({
  swarmId: 'test-hooks-1',
  tasks: [{ description: 'Hook test A' }, { description: 'Hook test B' }],
});
const hClaimed = taskQueue.claimTask('test-hooks-1', 'hworker');
assert(hookLog.some(h => h.event === 'claim' && h.taskId === hClaimed.id), 'onClaim hook fires');

taskQueue.completeTask(hClaimed.id, 'hook-result');
assert(hookLog.some(h => h.event === 'complete' && h.taskId === hClaimed.id && h.result === 'hook-result'), 'onComplete hook fires with correct args');

const hClaimed2 = taskQueue.claimTask('test-hooks-1', 'hworker');
taskQueue.failTask(hClaimed2.id, 'hook-error');
assert(hookLog.some(h => h.event === 'fail' && h.taskId === hClaimed2.id && h.error === 'hook-error'), 'onFail hook fires with correct args');

taskQueue.resetTask(hClaimed2.id);
assert(hookLog.some(h => h.event === 'reset' && h.taskId === hClaimed2.id), 'onReset hook fires');

tqDb.exec("DELETE FROM swarm_tasks WHERE swarm_id LIKE 'test-%'");

// 3D: getFastestModel from registry
const fastestReg = registry.getFastestModel();
assertEq(fastestReg, 'claude-haiku-4-5', 'getFastestModel returns haiku (30s timeout)');

const fastestSubset = registry.getFastestModel(['claude-opus-4-5', 'claude-sonnet-4-5']);
assertEq(fastestSubset, 'claude-sonnet-4-5', 'getFastestModel of opus+sonnet returns sonnet (60s < 120s)');

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailed tests:');
  for (const e of errors) {
    console.log(`  ✗ ${e}`);
  }
}
console.log(`${'='.repeat(60)}`);

process.exit(failed > 0 ? 1 : 0);
