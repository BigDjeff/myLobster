# MEMORY.md - Core Lessons & Preferences

## Personal Contact Info (DM-only)
- **Personal email:** <personal-email>
- This section exists here instead of USER.md so it only loads in
  private chats, never in group contexts.

## User Preferences
- **Writing:** Use the humanizer/style skill for drafts. User wants to
  avoid AI-sounding writing.
- **Tone in DMs:** More informal, friendly, and positively jokey in
  direct conversations. Friend-first, assistant-second.
- **Interests:** <user's interests and focus areas>
- **Content format preferences:** <how the user likes updates formatted>
- **Cross-posting rules:** <when to cross-post vs. store-only>
- **Time display:** All times shown must be in user's timezone.

## Project History (Distilled)

Full project history archived in reference/project-history.md.
Key current-state facts:
- <high-level summary of active integrations>
- <prompt stack configuration>
- <council/analysis system status>

## Content Preferences
- <format preferences for content the agent produces>
- <what to include/exclude in pitches, outlines, etc.>

## Knowledge Base Patterns
- <cross-posting rules, selective sharing decisions>

## Task Management Rules
- <how to handle updates to existing items vs. new items>

## Strategic Notes
- <key contacts and relationships, redact specific names for template>
- <priority areas for email/calendar monitoring>
- <active deals and partnerships, redact values for template>

## Security & Privacy Infrastructure
- **PII redaction:** Automated layer catches personal emails, phone
  numbers, dollar amounts. Wired into notification and delivery paths.
- **Data classification tiers:** Confidential (DM-only), Internal
  (group chats OK), Restricted (external only with approval).
- **Content gates:** Frontier scanner for outbound emails and
  security-sensitive operations.
- **Secret handling:** Never share credentials unless explicitly
  requested by name with confirmed destination.

## Analysis Patterns
- When the user asks about a recommendation in conversation, pull
  the data locally and include it in the reply. Don't re-post to
  messaging (creates duplicate messages).
- When discussing config changes, just make the fix. Skip the
  accounting of alternative approaches unless asked.

## LLM Usage Queries
- <how to query usage data, which tables/tools to use>

## Operational Lessons
- **Duplicate delivery prevention:** Content already posted is
  delivered. Don't re-send it. Address follow-up questions instead.
- **Lock files:** Check for stale lock files if ingestion hangs.
  Delete if the owning PID is dead.
- **Gateway token sync:** Multiple locations store the gateway token.
  After updates, verify they match.
- **Notification validation:** Always validate API responses, not
  just CLI exit codes. Silent failures happen.
- **Model routing:** All LLM calls route through a centralized router
  with comprehensive logging. Frontier scanner uses direct provider
  API calls for critical content gates.

## Email Triage Patterns
- **High priority:** Meetings, partner communications, payments,
  tax documents, family/school, bills
- **Medium:** Inbound leads, guest bookings, shipping
- **Low:** Newsletters, social notifications, marketing

## System Health & Monitoring
- Consolidated health check runs during heartbeats
- Persistent failure tracking alerts on repeated failures
- Notification batching reduces noise
- Council reliability via independent expert architecture
- Tiered testing (unit, integration, E2E)

---
*Specific task logs are moved to daily memory files to keep this
file concise.*