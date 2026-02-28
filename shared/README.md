# shared/ — Unified LLM Routing Layer

Single entry point for all LLM calls. Handles provider routing, OAuth auth, call logging, and cost estimation.

## Setup

### Anthropic (Claude)

```bash
npm install @anthropic-ai/claude-agent-sdk better-sqlite3
claude login   # sets CLAUDE_CODE_OAUTH_TOKEN
```

Add to `~/.agent/.env`:
```
CLAUDE_CODE_OAUTH_TOKEN=<your-token>
```

Remove `ANTHROPIC_API_KEY` if it exists (conflicts with OAuth mode).

### OpenAI (Codex)

Auth is via OAuth only:

```bash
openclaw login openai-codex
```

This writes a JWT to `~/.openclaw/agents/main/agent/auth.json` under the `openai-codex.access` key. No additional npm packages required — uses Node's built-in `fetch()`.

## Usage

```js
const { runLlm } = require('./shared/llm-router');

const result = await runLlm('Your prompt', {
  model: 'claude-sonnet-4',   // alias or full name
  caller: 'my-script',
});
console.log(result.text);
// { text, durationMs, provider }
```

Or use the Claude shortcut:
```js
const { runClaude } = require('./shared/llm-router');
const result = await runClaude('Summarise this.', { caller: 'summariser' });
```

Or use the OpenAI shortcut:
```js
const { runOpenAI } = require('./shared/llm-router');
const result = await runOpenAI('Explain this code.', { caller: 'explainer' });
// Defaults to gpt-5.3-codex
```

## Model aliases

| Alias | Resolves to |
|-------|-------------|
| sonnet-4 | claude-sonnet-4-5 |
| opus-4 | claude-opus-4-5 |
| haiku-4 | claude-haiku-4-5 |
| codex | gpt-5.3-codex |
| gpt-4o | gpt-4o |
| gpt-4 | gpt-4-turbo |
| gpt-3.5 | gpt-3.5-turbo |

## Modules

| File | Purpose |
|------|---------|
| model-utils.js | Alias resolution, provider detection |
| interaction-store.js | SQLite logger + cost estimator |
| anthropic-agent-sdk.js | OAuth wrapper around claude-agent-sdk |
| openai-chat.js | OpenAI Chat Completions API wrapper |
| llm-router.js | Unified router (start here) |

## Logs

Calls are logged to `data/llm_calls.db` (SQLite, WAL mode).
Prompts/responses truncated at 10K chars, secrets redacted before storage.

## Environment variables

| Var | Purpose |
|-----|---------|
| CLAUDE_CODE_OAUTH_TOKEN | Anthropic OAuth token |
| SKIP_SMOKE_TEST=1 | Skip startup auth check |
