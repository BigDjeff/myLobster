'use strict';

const fs = require('fs');
const path = require('path');
const OUTPUT_FILE = '/tmp/test-openai-output.txt';

function out(line) {
  process.stdout.write(line + '\n');
  fs.appendFileSync(OUTPUT_FILE, line + '\n');
}

const { runLlm, runOpenAI } = require('./shared/llm-router');
const { getDb } = require('./shared/interaction-store');

async function main() {
  // Clear output file
  fs.writeFileSync(OUTPUT_FILE, '');

  out('=== OpenAI LLM Router Test ===\n');

  // Test 1: Full prefix stripping + routing via runLlm
  out('--- Test 1: runLlm with openai-codex/gpt-5.3-codex ---');
  const r1 = await runLlm('Say hello in exactly 5 words.', {
    model: 'openai-codex/gpt-5.3-codex',
    caller: 'test-openai-1',
  });
  out('Response:   ' + r1.text);
  out('Provider:   ' + r1.provider);
  out('durationMs: ' + r1.durationMs);
  out('');

  // Test 2: Convenience wrapper runOpenAI (defaults to gpt-5.3-codex)
  out('--- Test 2: runOpenAI convenience wrapper ---');
  const r2 = await runOpenAI('What is 2+2? Reply with just the number.', {
    caller: 'test-openai-2',
  });
  out('Response:   ' + r2.text);
  out('Provider:   ' + r2.provider);
  out('durationMs: ' + r2.durationMs);
  out('');

  // Test 3: Existing alias gpt-4o still routes to OpenAI
  out('--- Test 3: runLlm with gpt-4o alias ---');
  const r3 = await runLlm('Reply with exactly ALIAS_OK and nothing else.', {
    model: 'gpt-4o',
    caller: 'test-openai-3',
  });
  out('Response:   ' + r3.text);
  out('Provider:   ' + r3.provider);
  out('durationMs: ' + r3.durationMs);
  out('');

  // Wait briefly for the async logs to flush
  await new Promise(r => setTimeout(r, 300));

  // Query recent rows from the DB to verify logging
  out('=== Recent OpenAI rows in llm_calls.db ===\n');
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, caller, model, provider, ok, cost_estimate
    FROM llm_calls
    WHERE provider = 'openai'
    ORDER BY id DESC
    LIMIT 5
  `).all();

  if (rows.length === 0) {
    out('(no openai rows found — logging may have failed)');
  } else {
    for (const row of rows) {
      out(`id=${row.id}  caller=${row.caller}  model=${row.model}  provider=${row.provider}  ok=${row.ok}  cost=$${row.cost_estimate.toFixed(8)}`);
    }
  }

  out('\nDone. All 3 tests completed.');
}

main().catch(err => {
  const msg = 'Test failed: ' + err.message;
  fs.appendFileSync(OUTPUT_FILE, msg + '\n');
  process.stderr.write(msg + '\n');
  process.exit(1);
});
