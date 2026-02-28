'use strict';

/**
 * code-review.js — Gap 3: AI code review before notification.
 *
 * Reads agent output (log files, git diffs) and runs a quick LLM review
 * before notifying the user. Catches common issues:
 *   - Obvious bugs or logic errors
 *   - Security concerns
 *   - Missing error handling
 *   - Incomplete implementations
 *
 * Used by check-agents.sh before sending task completion notifications.
 * Uses cheapest available model to minimize cost overhead.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { routedLlm } = require('./smart-router');

const LOG_DIR = path.join(process.env.HOME || '~', '.openclaw', 'logs');
const WORKSPACE = path.join(process.env.HOME || '~', '.openclaw', 'workspace');

const REVIEW_PROMPT = `You are a code reviewer. Analyze the following agent output and git diff for a completed task.

Task description: {{description}}

Agent output (last 50 lines of log):
---
{{log_tail}}
---

Git diff (changes made):
---
{{git_diff}}
---

Provide a concise review with:
1. VERDICT: PASS, WARN, or FAIL
2. ISSUES: List any problems found (empty if PASS)
3. SUMMARY: 1-2 sentence summary of what was done

Format your response as:
VERDICT: <PASS|WARN|FAIL>
ISSUES:
- <issue 1>
- <issue 2>
SUMMARY: <summary>

If there is no diff or the output looks like a simple prompt-response task (no code changes), just return:
VERDICT: PASS
ISSUES: none
SUMMARY: Task completed (no code changes)`;

/**
 * Read the tail of an agent's log file.
 * @param {string} taskId
 * @param {number} [lines=50]
 * @returns {string}
 */
function readAgentLog(taskId, lines = 50) {
  const logPath = path.join(LOG_DIR, `agent-${taskId}.log`);
  if (!fs.existsSync(logPath)) return '(no log file found)';

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const allLines = content.split('\n');
    return allLines.slice(Math.max(0, allLines.length - lines)).join('\n');
  } catch {
    return '(error reading log)';
  }
}

/**
 * Get the git diff for a branch/worktree.
 * @param {string} [branch] - Branch name or worktree path
 * @param {string} [taskId] - Task ID (for worktree path)
 * @returns {string}
 */
function getGitDiff(branch, taskId) {
  try {
    let cwd = WORKSPACE;

    // Check for worktree
    if (taskId) {
      const worktreePath = path.join(WORKSPACE, '.worktrees', taskId);
      if (fs.existsSync(worktreePath)) {
        cwd = worktreePath;
      }
    }

    // Get diff against main/master
    let diff = '';
    try {
      diff = execSync('git diff HEAD~1 --stat --patch 2>/dev/null || git diff --cached --stat --patch 2>/dev/null || echo "(no changes)"', {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
      });
    } catch {
      diff = '(unable to read git diff)';
    }

    // Truncate if too long (keep under 4000 chars for the LLM)
    if (diff.length > 4000) {
      diff = diff.slice(0, 4000) + '\n... (truncated)';
    }

    return diff;
  } catch {
    return '(no git repository or diff available)';
  }
}

/**
 * Run an AI code review on a completed agent task.
 *
 * @param {object} opts
 * @param {string} opts.taskId - Task ID
 * @param {string} opts.description - Task description
 * @param {string} [opts.branch] - Git branch name
 * @param {string} [opts.caller='code-review']
 * @returns {Promise<{verdict: string, issues: string[], summary: string, raw: string}>}
 */
async function reviewTask({ taskId, description, branch, caller = 'code-review' }) {
  const logTail = readAgentLog(taskId);
  const gitDiff = getGitDiff(branch, taskId);

  // Skip review if there's nothing meaningful to review
  if (logTail === '(no log file found)' && gitDiff === '(no changes)') {
    return {
      verdict: 'PASS',
      issues: [],
      summary: 'No output or changes to review.',
      raw: '',
    };
  }

  const prompt = REVIEW_PROMPT
    .replace('{{description}}', description || '(no description)')
    .replace('{{log_tail}}', logTail)
    .replace('{{git_diff}}', gitDiff);

  const result = await routedLlm(prompt, {
    strategy: 'cheapest',
    capability: 'review',
    caller,
  });

  return parseReviewResponse(result.text);
}

/**
 * Parse the structured review response.
 * @param {string} text
 * @returns {{verdict: string, issues: string[], summary: string, raw: string}}
 */
function parseReviewResponse(text) {
  const raw = text;

  // Extract verdict
  const verdictMatch = text.match(/VERDICT:\s*(PASS|WARN|FAIL)/i);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'PASS';

  // Extract issues
  const issues = [];
  const issuesMatch = text.match(/ISSUES:\s*\n([\s\S]*?)(?=SUMMARY:|$)/i);
  if (issuesMatch) {
    const issuesText = issuesMatch[1].trim();
    if (issuesText && !issuesText.match(/^-?\s*none\s*$/i)) {
      const lines = issuesText.split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^-\s*/, '').trim();
        if (cleaned && !cleaned.match(/^none$/i)) {
          issues.push(cleaned);
        }
      }
    }
  }

  // Extract summary
  const summaryMatch = text.match(/SUMMARY:\s*(.*)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : 'Review completed.';

  return { verdict, issues, summary, raw };
}

/**
 * Format a review result for inclusion in a Telegram notification.
 * @param {{verdict: string, issues: string[], summary: string}} review
 * @returns {string}
 */
function formatReviewForNotification(review) {
  const icon = review.verdict === 'PASS' ? '✓' : review.verdict === 'WARN' ? '⚠' : '✗';
  let msg = `Review: ${icon} ${review.verdict}\n${review.summary}`;

  if (review.issues.length > 0) {
    msg += '\nIssues:';
    for (const issue of review.issues.slice(0, 3)) {
      msg += `\n  - ${issue}`;
    }
    if (review.issues.length > 3) {
      msg += `\n  ... and ${review.issues.length - 3} more`;
    }
  }

  return msg;
}

module.exports = {
  reviewTask,
  readAgentLog,
  getGitDiff,
  parseReviewResponse,
  formatReviewForNotification,
};
