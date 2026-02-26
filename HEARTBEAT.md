# HEARTBEAT.md

## Output Rule
End heartbeat turns with NO_REPLY unless intervention is needed.
If memory/heartbeat-state.json is corrupted, reset it to:
`{"lastChecks":{"errorLog":null,"securityAudit":null,"lastDailyChecks":null}}`
Then alert the user.

## Every Heartbeat
- Update memory/heartbeat-state.json timestamps
- Git backup: run auto-git-sync. Alert only on merge conflicts or persistent push failures.
- Gateway usage sync: sync LLM calls from session transcripts into interaction store
- System health check (--notify)
- Cron failure deltas (--notify)
- Persistent failure check (--notify)

## Once Daily
- Data collection health deltas (--notify)
- Repo size check (alert if over 500MB)
- Memory index coverage (alert if below 80%)

## Weekly
- Verify gateway is bound to loopback only
- Verify gateway auth is enabled and token is non-empty
