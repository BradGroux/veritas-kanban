# v5.0 Performance and Load Test Notes

Review date: 2026-06-03

This note records the v5.0 performance/load evidence for SQLite-backed local
mode and trusted-host remote/mobile access. Release-candidate evidence belongs
in [v5 Release Candidate Evidence Packet](../V5-RC-EVIDENCE-PACKET.md).

## Target Dataset

| Surface                  | GA representative target |
| ------------------------ | -----------------------: |
| Active tasks             |                    1,500 |
| Task comments            |                    3,000 |
| Attachment metadata rows |                      600 |
| Telemetry events         |                    6,000 |
| Workflow runs            |                    1,200 |
| Chat sessions            |                       60 |
| Chat messages            |                    3,000 |

These targets represent a heavy solo/local board or a small team/agent-heavy
trusted-host deployment. Larger hosted or SaaS-style deployments are outside the
v5.0 GA scope and should run the full k6 profile with larger seed values before
being treated as supported.

## SQLite Benchmark Evidence

Command:

```bash
pnpm --filter @veritas-kanban/server test -- sqlite-performance.test.ts --reporter verbose
```

Recorded local result:

| Read path                  | Dataset exercised                                        | Result |   Budget |
| -------------------------- | -------------------------------------------------------- | -----: | -------: |
| Board task list            | 1,500 active tasks with comments and attachment metadata | 2.3 ms | 2,000 ms |
| Task search                | FTS-backed active task lookup                            | 0.5 ms |   750 ms |
| Dashboard telemetry window | 6,000 telemetry events                                   | 2.5 ms | 1,500 ms |
| Workflow running list      | 1,200 workflow runs                                      | 0.5 ms |   750 ms |
| Chat session history       | 50 messages in a task-scoped session                     | 0.1 ms |   750 ms |

The test also verifies representative query plans use the expected indexes:

- `idx_tasks_workspace_state_updated`
- `idx_telemetry_type_created`
- `idx_workflow_runs_status_started`
- `idx_chat_messages_session_created`

The query cleanup in this review removed `datetime(...)` wrappers from hot
SQLite ordering paths where ISO timestamp strings already preserve chronological
order. That lets SQLite use index-ordered scans for task lists, telemetry
windows, workflow run lists, and chat history.

## Remote and WebSocket Load Evidence

The full k6 profile now runs:

```bash
pnpm test:load
```

The scheduled QA workflow also runs the same full profile when dispatched with
`load_profile=full`.

Full profile scripts:

- `smoke`
- `read-load`
- `write-load`
- `mixed-load`
- `ws-stress`
- `v5-remote-mix`

`v5-remote-mix` defaults:

| Setting                 |    Default |
| ----------------------- | ---------: |
| Seed tasks              |        120 |
| Seed chat sessions      |         12 |
| HTTP virtual users      |         20 |
| WebSocket virtual users |         30 |
| Duration                | 45 seconds |
| WebSocket hold time     | 40 seconds |

The profile covers:

- board list and task detail reads
- task search
- dashboard metrics
- workflow run metadata
- chat history
- task create/update/delete churn
- WebSocket task, workflow, agent-output, and chat-session subscriptions

Thresholds keep p95 read/write paths between 250 ms and 750 ms and require
HTTP errors below 1 percent plus WebSocket connection errors below 5 percent.

## Recommended Limits

- Treat the target dataset above as the supported v5.0 GA local/small-team
  baseline until larger full-profile k6 runs are attached to release notes.
- Keep telemetry retention at the default 30 days for active local installs.
- Archive or prune old workflow runs, chat sessions, completed work products,
  and attachment metadata through the maintenance/data-lifecycle work in #367
  and #421 before claiming larger long-lived datasets.
- Remote/mobile access remains a trusted-host scenario. The browser
  password-session blocker documented in the v5 security review still has to be
  resolved or explicitly scoped before multi-user/server-mode GA.

## Remaining Risks

- `v5-remote-mix` validates API, dashboard, search, workflow, chat, and
  WebSocket server behavior. It does not measure native mobile browser rendering
  performance.
- Scheduled k6 runs use generated seed data. Before GA, attach the workflow
  artifacts from a `load_profile=full` run against the release candidate to
  [v5 Release Candidate Evidence Packet](../V5-RC-EVIDENCE-PACKET.md).
- Large-team or SaaS-style deployments need follow-up load profiles with higher
  seed counts and longer soak windows.
