# CLI Command: `vk agent pull`

**Status:** Design Spec (not yet implemented)

## Purpose

Fetch and format results from a sub-agent run into a concise summary for the main session.

## Usage

```bash
# Pull results by session key
vk agent pull agent:main:subagent:UUID

# Pull results by label
vk agent pull --label rel-001-filelocks

# Pull all pending results
vk agent pull --all

# Output as JSON
vk agent pull agent:main:subagent:UUID --json
```

## Output Format (Default)

```
✅ Sub-Agent Complete: rel-001-filelocks

Summary:
  • Added withFileLock() to 5 services
  • All typechecks pass
  • No logic changes, only locking added

Artifacts:
  • server/src/services/activity-service.ts (modified)
  • server/src/services/status-history-service.ts (modified)
  • server/src/services/notification-service.ts (modified)
  • server/src/services/managed-list-service.ts (modified)
  • server/src/services/chat-service.ts (modified)

Metrics:
  Duration: 2m 34s
  Tokens: ~15k
  Cost: $0.03

Blockers: None
```

## Output Format (JSON)

```json
{
  "id": "result_20260205_abc123",
  "label": "rel-001-filelocks",
  "status": "completed",
  "summary": {
    "bullets": ["Added withFileLock() to 5 services", "All typechecks pass"],
    "artifacts": [{ "path": "server/src/services/activity-service.ts", "description": "modified" }],
    "blockers": []
  },
  "metrics": {
    "durationMs": 154000,
    "tokensUsed": 15000,
    "cost": 0.03
  }
}
```

## Implementation Notes

1. **Data Source:** Read from OpenClaw's session transcript via `sessions_history`
2. **Parsing:** Extract structured summary from agent's final message
3. **Registry:** Update `.veritas-kanban/agent-results.json` with result
4. **Linking:** If `--task` flag provided, link result to VK task

## Related

- Spawn template: `~/clawd/templates/subagent-task.md`
- Result schema: `.veritas-kanban/agent-results.schema.json`
- VK task: `task_20260205_WNvH6j`
