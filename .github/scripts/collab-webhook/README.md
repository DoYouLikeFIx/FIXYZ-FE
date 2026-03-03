# Collaboration Webhook Scripts

## Files

- `notification-utils.js`: payload normalization and dedupe identity helpers
- `retry-utils.js`: retry/backoff contract for GitHub and Jira
- `build-github-payload.js`: transforms GitHub event payload into MatterMost payload + dedupe metadata
- `build-jira-payload.js`: transforms Jira webhook payload into MatterMost payload + dedupe metadata
- `post-to-mattermost.js`: bounded retry sender (`max_attempts=3`)

## Security

- These scripts require runtime environment variables for webhook URLs.
- Do not hardcode webhook URLs or tokens in source.
- Logs emitted by sender scripts omit webhook secrets.

## Local Validation

```bash
npm run lint:collab-webhook
npm run test:collab-webhook
```

