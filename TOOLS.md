# TOOLS.md - Local Notes

Environment-specific values only (IDs, paths, and where secrets live).
Skills define how tools work.

## Secrets and config
- Canonical .env: ~/.agent/.env
- Compatibility symlinks: ~/<workspace>/.env, ~/<workspace>/crm/.env
- Platform config: ~/.agent/config.json

## Attribution
- When leaving permanent text (comments, messages, notes), prefix with
  "<emoji> <AgentName>:" unless asked to ghostwrite

## Primary Messaging Platform (e.g., Telegram)
- Group ID: <your-group-id>

| Topic | Thread ID |
|-------|-----------|
| <topic-name> | <id> |
| <topic-name> | <id> |
| <topic-name> | <id> |
| cron-updates | <id> |
| knowledge-base | <id> |
| financials | <id> |

## Topic behavior (quick)
- <topic>: <behavior description, e.g., "cron-owned; respond to follow-ups only">
- <topic>: <behavior description, e.g., "CRM queries and follow-ups">
- <topic>: <behavior description, e.g., "failures only">
- <topic>: <behavior description, e.g., "owner only; never share outside DM">

## Secondary Platform (e.g., Slack)

| Channel | ID |
|---------|----|
| <channel-name> | <id> |
| <channel-name> | <id> |

## Project Management (e.g., Asana)
- Workspace: <workspace-name> (<workspace-id>)

| Project | ID |
|---------|-----|
| <project-name> | <id> |
| <project-name> | <id> |

## Paths
- Email CLI: <path to email tool>
- Agent CLI: <path to coding agent>
- Logs: ~/<workspace>/data/logs/ (unified: all.jsonl),
  SQLite mirror: ~/<workspace>/data/logs.db

## API tokens
Stored in ~/.agent/.env. See .env.example for the canonical list.

## Voice Memos
- **Inbound:** User can send voice memos. The gateway auto-transcribes
  them to text.
- **Outbound:** Use the tts tool to reply as a voice note.
- **Rule:** Only reply with voice when explicitly asked. Default to text.

## Content preferences
- <Add user-specific content preferences here>

## Dual prompt stack
- Default: root .md files (<primary-model>)
- Fallback: codex-prompts/ (<secondary-model>, loaded when active)
- Switching is configured in your agent framework's config and requires
  a gateway restart
