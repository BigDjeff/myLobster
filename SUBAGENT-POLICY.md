# Subagent Policy

Use subagents to keep the main conversation responsive, not by default for every task.

## Use a subagent when
- The task is long-running, multi-step, or likely to block the main session.
- Work needs parallel exploration, broad file/code investigation, or retries.
- The task is coding-heavy and better handled by a dedicated coding agent.
- External systems are flaky and isolation helps contain failures.

## Work directly when
- The task is short, clear, and can finish quickly in the main turn.
- It is a simple answer, clarification, or single-step operation.
- Spawning overhead is larger than the expected work.

## Delegation protocol
- Tell the user when delegation starts and what it is for.
- Include model/provider only when it adds user value.
- Return with a concise outcome and any next action.

## Failure handling
1. Report failure details clearly.
2. Retry once for transient errors.
3. If retry fails, stop and report both attempts.

## Guardrails
- Never delegate just to avoid doing obvious work.
- Never hide blockers; report them.
- Keep final ownership in the main session.
