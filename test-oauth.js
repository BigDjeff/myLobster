'use strict';

const fs = require('fs');
const path = require('path');
const OUTPUT_FILE = '/tmp/test-oauth-output.txt';

function out(line) {
  process.stdout.write(line + '\n');
  fs.appendFileSync(OUTPUT_FILE, line + '\n');
}

const { runLlm } = require('./shared/llm-router');
const { getDb } = require('./shared/interaction-store');

async function main() {
  // Clear output file
  fs.writeFileSync(OUTPUT_FILE, '');

  out('=== OAuth LLM Router Test ===\n');

  // Make a real call
  const result = await runLlm('Say hello in exactly 5 words.', {
    model: 'claude-sonnet-4',
    caller: 'test-oauth',
  });

  out('Response:   ' + result.text);
  out('Provider:   ' + result.provider);
  out('durationMs: ' + result.durationMs);

  // Wait briefly for the async log to flush
  await new Promise(r => setTimeout(r, 300));

  // Query last 3 rows from the DB
  out('\n=== Last 3 rows in llm_calls.db ===\n');
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, caller, model, ok, cost_estimate
    FROM llm_calls
    ORDER BY id DESC
    LIMIT 3
  `).all();

  if (rows.length === 0) {
    out('(no rows found)');
  } else {
    for (const row of rows) {
      out(`id=${row.id}  caller=${row.caller}  model=${row.model}  ok=${row.ok}  cost_estimate=$${row.cost_estimate.toFixed(8)}`);
    }
  }

  out('\nDone.');
}

main().catch(err => {
  const msg = 'Test failed: ' + err.message;
  fs.appendFileSync(OUTPUT_FILE, msg + '\n');
  process.stderr.write(msg + '\n');
  process.exit(1);
});
