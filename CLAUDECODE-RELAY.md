# ClaudeCode Relay Mode (Strict)

Purpose: OpenClaw acts as a thin orchestrator between Jeff and Claude Code terminal sessions.

## Trigger
- Enter this mode only when user message starts with `CLAUDECODE `.
- Presets:
  - `CLAUDECODE START`: start/mark the single active Claude Code session.
  - `CLAUDECODE STOP`: stop/clear the current Claude Code session.
- Default relay for `CLAUDECODE <prompt>` uses `scripts/claudecode-run.sh` in single-session mode:
  - first prompt starts a session (`claude -p`)
  - next prompts continue the same session (`claude -p -c`)

## Defaults
- Default working directory: `/Users/jeffcheng/.openclaw`.
- Single session state file: `/Users/jeffcheng/.openclaw/workspace/data/claudecode-session.state`.

## Prompt/Response Fidelity
- Prompt handoff: pass text after `CLAUDECODE ` exactly as-is, no rewriting.
- Response return: provide terminal output word-for-word, no paraphrase.

## Orchestrator-Only Behavior
- Allowed actions: start/send/read/stop relay session.
- Do not run extra planning, web, memory lookup, or unrelated tools unless explicitly asked.

## Token Minimization Rules
- No narration around routine calls.
- No summaries unless explicitly requested.
- For START/STOP/ERROR, use single-line status replies.
- Do not inject additional context into Claude prompts.

## Helper scripts
- `scripts/claudecode-run.sh` (default for `CLAUDECODE <prompt>`, single-session continue mode)
- `scripts/claudecode-start.sh` (`CLAUDECODE START`)
- `scripts/claudecode-stop.sh` (`CLAUDECODE STOP`)
