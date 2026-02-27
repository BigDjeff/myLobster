# HEARTBEAT.md

## Output Rule
End heartbeat turns with NO_REPLY unless intervention is needed.
If memory/heartbeat-state.json is corrupted, reset it to:
`{"lastChecks":{"errorLog":null,"securityAudit":null,"lastDailyChecks":null}}`
Then alert the user.

## Every Heartbeat
- Update memory/heartbeat-state.json timestamps
- Run auto-git-sync (alert only on merge conflicts or persistent push failures)
- Sync gateway LLM usage from session transcripts
- Run system health check (--notify)
- Run cron failure deltas (--notify)
- Run persistent failure check (--notify)

## Once Daily
- Run data collection health deltas (--notify)
- Check repo size (alert if over 500MB)
- Check memory index coverage (alert if below 80%)

## Weekly
- Verify gateway is bound to loopback only
- Verify gateway auth is enabled and token is non-empty
