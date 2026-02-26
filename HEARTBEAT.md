# HEARTBEAT.md

## Reporting
Heartbeat turns should usually end with NO_REPLY.
Use the notifier scripts with --notify, let them handle one-time
failure/recovery delivery:
- Cron failure deltas
- Persistent failure checks
- System health checks
- Data collection health deltas

Only send a direct heartbeat message when the notifier path itself is
broken and the user needs intervention.

If memory/heartbeat-state.json is corrupted, replace it with:
{"lastChecks": {"errorLog": null, "securityAudit": null, "lastDailyChecks": null}}
Then alert the user.

## Every heartbeat
- Update memory/heartbeat-state.json timestamps for checks performed
- Git backup: run your auto-git-sync script. If it exits non-zero, log
  a warning and continue. Alert the user only for real breakages
  (merge conflicts, persistent push failures).
- Gateway usage sync: sync gateway LLM calls from session transcripts
  into your interaction store so all model usage is centrally tracked
- System health check (with --notify so critical issues route with
  explicit priority)
- Cron failure deltas (with --notify)
- Persistent failure check (with --notify)

## Once daily
- Data collection health deltas (with --notify)
- Repo size check (alert if git repo exceeds a threshold, e.g., 500MB)
- Memory index coverage (alert if below 80% indexed)

## Weekly
- Verify gateway is bound to loopback only
- Verify gateway auth is enabled and token is non-empty