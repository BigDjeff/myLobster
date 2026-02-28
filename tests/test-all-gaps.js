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
