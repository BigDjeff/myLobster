# OpenClaw Workspace — Claude Code Rules

Priority: top to bottom = most important to least important.

## Validation Loop

These are the commands Claude should run to validate changes. Run after every code change.

```bash
# Syntax check any modified .js file
node --check <file.js>

# Run the full test suite (94 tests, no live LLM calls)
npm test

# Check bash scripts are executable
test -x scripts/<script.sh>

# Verify strict mode in bash scripts
head -3 scripts/<script.sh>  # should show set -euo pipefail
```

**If any validation step fails, fix it before moving on.** Do not proceed with broken code.

## Critical Rules

### Never Do
- Never hardcode credentials, API keys, or tokens — all auth is OpenAI OAuth (JWT tokens in auth.json)
- Never bypass the OpenAI OAuth flow or add API key auth
- Never delete SQLite databases in `data/` (agent_comms.db, llm_calls.db, swarm_tasks.db)
- Never modify IDENTITY.md, SOUL.md, or USER.md without asking the user first — these are personality/memory files
- Never install new npm dependencies without asking — the project has only 2 deps by design
- Never make direct LLM API calls — always use `shared/llm-router.js`
- Never skip WAL mode when creating new SQLite databases
- Never create new files when editing an existing one would work
- Never duplicate content from AGENTS.md, SUBAGENT-POLICY.md, SOUL.md, or TOOLS.md — reference them instead

### Always Do
- Always use `shared/llm-router.js` as the single entry point for all LLM calls
- Always log LLM interactions via `shared/interaction-store.js`
- Always use `'use strict';` at the top of every JavaScript file
- Always use `set -euo pipefail` in bash scripts (after `#!/usr/bin/env bash`)
- Always use WAL mode for SQLite (`PRAGMA journal_mode=WAL`)
- Always run `npm test` after making changes to shared/ or tests/
- Always use CommonJS (`require`/`module.exports`) — no ES modules
- Always quote file paths in bash scripts

## Architecture Overview

OpenClaw is an AI agent orchestration platform. It spawns, monitors, and coordinates multiple AI agents.

```
workspace/
├── shared/          # Core Node.js modules (LLM routing, agent comms, task management)
├── scripts/         # Bash automation (agent lifecycle, monitoring, cron jobs)
├── tests/           # Integration tests (test-all-gaps.js)
├── data/            # SQLite databases + logs (DO NOT DELETE)
├── memory/          # Persistent state (heartbeat, daily notes)
├── .openclaw/       # Workspace state
├── AGENTS.md        # Security rules, data classification, execution bias
├── SUBAGENT-POLICY.md # When/how to delegate to subagents
├── SOUL.md          # AI personality and voice definition
├── IDENTITY.md      # AI identity (name, traits)
├── USER.md          # User info (Jeff, Melbourne timezone)
├── TOOLS.md         # API paths, token locations, platform config
├── BOOTSTRAP.md     # First-run onboarding guide
├── HEARTBEAT.md     # Monitoring/health check procedures
└── MEMORY.md        # Learned patterns (DM-only context)
```

## LLM Provider Setup

**Active provider: OpenAI only.** The platform currently runs on `gpt-5.3-codex` via OpenAI OAuth.

- Auth credentials: `~/.openclaw/agents/main/agent/auth.json` → `openai-codex` key
- Token refresh: automatic via `https://auth.openai.com/oauth/token`
- No API keys — OAuth JWT tokens only
- Anthropic provider code exists in `shared/anthropic-agent-sdk.js` but is **not actively used**

The `codex` alias in model-utils.js resolves to `gpt-5.3-codex`. Use `runOpenAI()` or `runLlm(prompt, { model: 'gpt-5.3-codex' })`.

## Key Modules

### shared/llm-router.js
Single entry point for all LLM calls. Routes to OpenAI (active) or Anthropic (inactive) based on model name. Convenience wrappers:
- `runOpenAI(prompt, opts)` — defaults to `gpt-5.3-codex` (primary)
- `runClaude(prompt, opts)` — defaults to `claude-sonnet-4-5` (not in use)
- `runLlm(prompt, opts)` — generic, auto-detects provider from model name

Model aliases (defined in `shared/model-utils.js`):
- `codex` → `gpt-5.3-codex` (primary model)
- `gpt-4o` → `gpt-4o`
- `sonnet-4` → `claude-sonnet-4-5` (not in use)
- `opus-4` → `claude-opus-4-5` (not in use)
- `haiku-4` → `claude-haiku-4-5` (not in use)

### shared/openai-chat.js
OpenAI Chat Completions API wrapper. Handles OAuth token resolution, auto-refresh on expiry, smoke test validation, and call logging. This is the active LLM backend.

### shared/interaction-store.js
SQLite-backed logger for all LLM interactions. Tracks costs, truncates prompts/responses at 10K chars, redacts secrets.

### shared/agent-comms.js
Agent-to-agent communication layer with SQLite persistence.

### scripts/check-agents.sh
Primary monitoring script. Runs every 10 minutes via cron. Detects failures, handles notifications. Uses zero LLM tokens.

### scripts/spawn-agent.sh
Spawns coding agents in tmux sessions with full lifecycle management.

## Coding Patterns

### JavaScript
- CommonJS only: `const x = require('./x');`
- Strict mode: `'use strict';` first line
- Error-first pattern for callbacks
- Use `better-sqlite3` for all database access (synchronous API)
- WAL mode on all SQLite connections
- No classes unless wrapping complex state — prefer functions and modules

### Bash
- Shebang: `#!/usr/bin/env bash`
- Strict mode: `set -euo pipefail`
- Quote all variables: `"${var}"`
- Use `readonly` for constants
- Log to stderr for diagnostics: `echo "..." >&2`

### Database
- All databases live in `data/`
- WAL mode required: `PRAGMA journal_mode=WAL;`
- Prompts/responses truncated at 10K characters
- Secrets auto-redacted before storage

## Workflow

1. **Start in plan mode** for any non-trivial changes
2. **Read existing docs** before modifying behavior (AGENTS.md, SUBAGENT-POLICY.md, etc.)
3. **Make changes** — edit existing files, don't create new ones unless necessary
4. **Validate** — run `node --check` on changed JS files, then `npm test`
5. **Fix failures** — if tests fail, fix before moving on
6. **Commit** — use git for checkpoints before risky changes

## Dependencies

Only two npm dependencies — keep it minimal:
- `@anthropic-ai/claude-agent-sdk` — Anthropic SDK (exists in code but not actively used)
- `better-sqlite3` — SQLite3 wrapper (synchronous)

The active LLM backend (`shared/openai-chat.js`) uses Node's built-in `fetch` — no additional HTTP deps needed.

Do not add new dependencies without explicit user approval.

## Reference Documents

For detailed rules on specific topics, read these files (do not duplicate their content):
- **Security & execution rules**: AGENTS.md
- **Subagent delegation strategy**: SUBAGENT-POLICY.md
- **AI personality/voice**: SOUL.md
- **Platform config & API paths**: TOOLS.md
- **Health monitoring procedures**: HEARTBEAT.md
