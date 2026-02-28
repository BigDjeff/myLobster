# Subagent Policy

Core directive: anything other than a simple conversational message should spawn a subagent.

## When to use a subagent
Use a subagent for:
- Searches (web, social, email)
- API calls
- Multi-step tasks
- Data processing
- File operations beyond simple reads
- Calendar/email operations
- Any task expected to take more than a few seconds
- Anything likely to fail or block the main session

## When to work directly
Handle these without a subagent:
- Simple conversational replies
- Quick clarifying questions
- Acknowledgments
- Quick file reads for context
- Single-step lookups where spawn overhead is slower than direct execution

The goal is responsiveness, not subagent usage for its own sake.

## Delegation model
All coding, debugging, and investigation work should run through subagents.

Complexity routing:
- **Simple:** Subagent can handle directly (small config changes, single-file fixes, one-log checks).
- **Medium/Major:** Delegate to coding-agent CLI via subagent.

Model routing remains centralized in `config/model-routing.json`.

## Coordination over static todos
- Prefer task-based coordination that subagents can update, split, or replace.
- Avoid rigid static todo lists that prevent adaptation when new information appears.
- Keep one shared task state when parallel subagents are used.

## Delegation announcements
When delegating, tell Jeff the model and provider/tool.

Format: `[model] via [provider/tool]`

If fallback model/provider is used, call it out in completion as well.

## Failure handling
When a subagent fails:
1. Report error details to Jeff
2. Retry once for transient failures (timeouts, rate limits)
3. If retry fails, report both attempts and stop

## Context Discipline
Bring work TO the context that created it. Do not spread a task's context across agents.

Anti-patterns:
- Separate agents for "planning", "coding", "testing", "reviewing" the same change. Testing needs the context of how the code was written.
- "CEO agent / product agent / design agent" patterns. These fragment context and lose the reasoning chain.
- Delegating investigation and then asking for the full context back. The sub-agent's output is a summary, not a replay.

Good sub-agent use:
- Atomic side effects: send a notification, fetch a URL, look up a value.
- Parallel data gathering that returns a small summary.
- Work that is genuinely isolated and doesn't need the parent's recent context.
- Token-heavy lookups within workflows: if a skill needs to search through a large dataset (e.g., scanning project management tasks, parsing logs), delegate that search to a sub-agent so the parent's context stays lean. The sub-agent returns only the relevant results.

## Guardrails
- Never delegate to avoid obvious direct work.
- Never hide blockers.
- Keep final ownership in the main session.
