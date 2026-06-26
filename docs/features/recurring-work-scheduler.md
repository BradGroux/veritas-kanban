# Recurring Work Scheduler

The recurring work scheduler gives operators one place to inspect and control scheduled Veritas work.

It currently surfaces:

- scheduled deliverables, including operations digest deliverables
- workflow definitions with enabled non-manual schedules
- workflow scheduled-snapshot outputs

## Operator Controls

The scheduler is available in `Settings -> Scheduler`, through `vk scheduler`, and through `/api/scheduler`.

Each scheduler item exposes:

- health: `healthy`, `warning`, `paused`, or `blocked`
- next and last run timestamps
- retry attempts and next retry time
- recent scheduler events
- manual run, pause, resume, and validate actions

## Execution Model

Scheduled deliverables run through the existing scheduled deliverables runner. Workflow schedules run through the existing workflow run service and create a normal workflow run record.

The due-runner refuses overlapping scheduler passes and refuses overlapping item runs in the same server process. Failed scheduler runs record retry state with exponential backoff up to the configured retry limit. Scheduler executions also emit bounded run telemetry with `agent=scheduler` and `project=operations`, so operations digests can include scheduler activity.

## Custom Cron

Custom cron schedules are visible, manually runnable, and validated for a cron expression, but automatic cron due execution is intentionally not enabled in this first pass. Standard `daily`, `weekly`, `biweekly`, and `monthly` schedules have deterministic due calculation without adding a new production dependency.

## CLI

```bash
vk scheduler list
vk scheduler run-due
vk scheduler run "scheduled-deliverable:del_ops"
vk scheduler pause "workflow:weekly-snapshot"
vk scheduler resume "workflow:weekly-snapshot"
vk scheduler validate "workflow:weekly-snapshot"
```

Use `--json` on any command for automation-friendly output.

## API

Mounted at `/api/scheduler`.

| Method | Path                                | Description                     |
| ------ | ----------------------------------- | ------------------------------- |
| `GET`  | `/api/scheduler`                    | List scheduler items and events |
| `GET`  | `/api/scheduler/items/:id`          | Read one scheduler item         |
| `POST` | `/api/scheduler/items/:id/run`      | Run one scheduler item now      |
| `POST` | `/api/scheduler/items/:id/pause`    | Pause one scheduler item        |
| `POST` | `/api/scheduler/items/:id/resume`   | Resume one scheduler item       |
| `POST` | `/api/scheduler/items/:id/validate` | Validate one scheduler item     |
| `POST` | `/api/scheduler/due/run`            | Run all items due now           |
