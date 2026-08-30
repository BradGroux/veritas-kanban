# Recurring Work Scheduler

The recurring work scheduler gives operators one place to inspect and control scheduled Veritas work.

It currently surfaces:

- scheduled deliverables, including operations digest deliverables
- workflow definitions with enabled non-manual schedules
- workflow scheduled-snapshot outputs
- queue intake monitors

## Operator Controls

The scheduler is available in `Settings -> Scheduler`, through `vk scheduler`, and through `/api/scheduler`.

Settings also includes an automation-draft compiler. It turns recurring-work intent plus optional structured hints into an immutable `automation-draft/v1` preview. Previewing or saving a draft never creates a scheduler item, reservation, run, provider queue, approval, credential lease, or external action.

Each scheduler item exposes:

- health: `healthy`, `warning`, `paused`, or `blocked`
- next and last run timestamps
- retry attempts and next retry time
- recent scheduler events
- manual run, pause, resume, and validate actions

Queue monitors appear as `queue-monitor:<monitorId>` items. They use the monitor interval and execute through the queue monitor service, so Run Due can scan GitHub queues without bypassing monitor policy gates.

## Execution Model

Scheduled deliverables run through the existing scheduled deliverables runner. Workflow schedules run through the existing workflow run service and create a normal workflow run record. Queue monitors run through the policy-gated queue monitor service and record their own candidate packet before the scheduler records the recurring event.

The due-runner refuses overlapping scheduler passes and refuses overlapping item runs in the same server process. Failed scheduler runs record retry state with exponential backoff up to the configured retry limit. Scheduler executions also emit bounded run telemetry with `agent=scheduler` and `project=operations`, so operations digests can include scheduler activity.

## Custom Cron

Custom cron schedules are visible, manually runnable, and validated for a cron expression, but automatic cron due execution is intentionally not enabled in this first pass. Standard `daily`, `weekly`, `biweekly`, and `monthly` schedules have deterministic due calculation without adding a new production dependency.

## Automation Drafts

The compiler recognizes exact daily, weekday, named-weekday, and bounded minute-interval language. It also accepts a five-field cron expression. Every preview shows its IANA timezone and three representative future UTC timestamps; the calculation preserves the requested local wall-clock time across daylight-saving changes.

Consequential values are never silently defaulted. Each field records its value, origin, confidence, status, and explanation. Missing or conflicting schedule, execution target, provider, expiry, overlap policy, retry posture, output, scope, budget, integration, or stop-condition data remains a validation blocker.

The standing-scope object separately lists reads, writes, sends, external targets, artifact destinations, integration and credential definition IDs, tools, and approval-required actions. Draft serialization removes URL credentials, query strings, fragments, and common inline secret assignments. Only safe integration identifiers are persisted; raw integration configuration and credential values are not accepted.

Saved revisions remain inactive and immutable. Revision, clone, and delete operations touch only the bounded `drafts` collection in scheduler state. Activation is intentionally a separate future workflow.

## CLI

```bash
vk scheduler list
vk scheduler run-due
vk scheduler run "scheduled-deliverable:del_ops"
vk scheduler run "queue-monitor:veritas-backlog-high-priority"
vk scheduler pause "workflow:weekly-snapshot"
vk scheduler resume "workflow:weekly-snapshot"
vk scheduler validate "workflow:weekly-snapshot"
vk scheduler draft preview --intent "Every weekday at 9 AM create a support report" --request-id draft-preview --hints '{"timezone":"America/Chicago"}' --json
vk scheduler draft save --intent "Every weekday at 9 AM create a support report" --request-id draft-save --hints '{"timezone":"America/Chicago"}' --json
vk scheduler draft list --json
vk scheduler draft show automation_ID --json
vk scheduler draft revise automation_ID --intent "Every weekday at 8 AM create a support report" --request-id draft-revise --hints '{"timezone":"America/Chicago"}' --json
vk scheduler draft clone automation_ID --request-id draft-clone --json
vk scheduler draft delete automation_ID --confirm automation_ID --json
```

Use `--json` on any command for automation-friendly output.

## API

Mounted at `/api/scheduler`.

| Method   | Path                                  | Description                     |
| -------- | ------------------------------------- | ------------------------------- |
| `GET`    | `/api/scheduler`                      | List scheduler items and events |
| `GET`    | `/api/scheduler/items/:id`            | Read one scheduler item         |
| `POST`   | `/api/scheduler/items/:id/run`        | Run one scheduler item now      |
| `POST`   | `/api/scheduler/items/:id/pause`      | Pause one scheduler item        |
| `POST`   | `/api/scheduler/items/:id/resume`     | Resume one scheduler item       |
| `POST`   | `/api/scheduler/items/:id/validate`   | Validate one scheduler item     |
| `POST`   | `/api/scheduler/due/run`              | Run all items due now           |
| `POST`   | `/api/scheduler/drafts/preview`       | Compile without saving          |
| `GET`    | `/api/scheduler/drafts`               | List latest inactive revisions  |
| `POST`   | `/api/scheduler/drafts`               | Save an inactive draft          |
| `GET`    | `/api/scheduler/drafts/:id`           | Read a draft revision           |
| `POST`   | `/api/scheduler/drafts/:id/revisions` | Append an immutable revision    |
| `POST`   | `/api/scheduler/drafts/:id/clone`     | Clone as another inactive draft |
| `DELETE` | `/api/scheduler/drafts/:id`           | Delete all inactive revisions   |
