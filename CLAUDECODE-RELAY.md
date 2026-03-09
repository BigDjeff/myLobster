# ClaudeCode Relay Mode (Strict)

Purpose: OpenClaw acts as a thin orchestrator between Jeff and Claude Code terminal sessions.

## Trigger
- Enter this mode only when user message starts with `CLAUDECODE `.
- Presets:
  - `CLAUDECODE START`: start a fresh Claude Code session.
  - `CLAUDECODE STOP`: stop the current Claude Code session.

## Defaults
- Default working directory: `/Users/jeffcheng/.openclaw`.
- Default tmux session name: `claudecode-relay`.

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
- `scripts/claudecode-start.sh`
- `scripts/claudecode-send.sh`
- `scripts/claudecode-capture.sh`
- `scripts/claudecode-stop.sh`
