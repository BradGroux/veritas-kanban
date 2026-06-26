# Queue Intake Monitor

Queue intake monitors scan bounded GitHub issue and pull request queues, build an inspectable candidate packet, and decide the next safe action under Veritas policy gates.

The first adapter is GitHub-backed. Monitor state is stored in `.veritas-kanban/queue-monitors.json`, and the default monitor scans open high-priority items in `BradGroux/veritas-kanban` in `dry-run` mode.

## Operator Surfaces

- Settings -> Queues shows monitor health, next scan, last packet, selected work, skipped reasons, and visible action items.
- Settings -> Scheduler includes queue monitors as `queue-monitor:<id>` recurring work items.
- `vk queue-monitors` provides list, run, explain, health, pause, and resume commands.
- `/api/queue-monitors` exposes the same state for local and remote clients.
- Operations digest output includes queue monitor events and skipped-work counts inside the digest window.

## Candidate Packets

A run fetches a bounded set of GitHub issues and PRs from the configured repo and labels. The packet records:

- candidates with repo, number, title, URL, labels, assignees, author, timestamps, CI state, blockers, score, and score reasons
- selected candidate, if any unblocked candidate remains
- skipped candidates with explicit reasons
- gate checks for GitHub scan, watcher policy, sandbox, budget, and workflow preflight

Selection is deterministic. Priority labels, unassigned issues, passing PR checks, and age increase score. Blocked labels, draft PRs, and failed PR checks become skipped reasons by default.

## Modes

| Mode          | Behavior                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `dry-run`     | Records the selected candidate and skipped reasons without mutating GitHub or starting workflows.   |
| `draft-plan`  | Records a local plan intent without mutation.                                                       |
| `assign-only` | Assigns the selected GitHub issue/PR only after policy, budget, sandbox, and stop checks pass.      |
| `execute`     | Starts `workflowId` only after every policy, budget, sandbox, workflow, auth, and stop gate passes. |

Execute mode fails closed when `workflowId` is missing, the workflow cannot dry-run, policy requires approval, budget blocks launch, sandbox enforcement blocks, GitHub auth fails, runner dispatch is unavailable, or stop conditions are tripped.

`runner: "local"` is the executable runner in this version. `runner: "github-actions"` is part of the persisted monitor model, but launch is blocked until a workflow-dispatch adapter is configured.

## Circuit State

Each failed or blocked run increments `failureStreak`. When it reaches `stopConditions.maxFailureStreak`, the monitor health becomes `blocked` and an `actionItem` is exposed with remediation. The scheduler will not run blocked monitors until an operator fixes the condition and resumes or updates the monitor.

## CLI

```bash
vk queue-monitors list
vk queue-monitors explain veritas-backlog-high-priority
vk queue-monitors run veritas-backlog-high-priority
vk queue-monitors health veritas-backlog-high-priority
vk queue-monitors pause veritas-backlog-high-priority
vk queue-monitors resume veritas-backlog-high-priority
```

Use `--json` on any command for scripts.

## API

Mounted at `/api/queue-monitors`.

| Method | Path                              | Description                                               |
| ------ | --------------------------------- | --------------------------------------------------------- |
| `GET`  | `/api/queue-monitors`             | List monitors, health, candidate packet state, and events |
| `GET`  | `/api/queue-monitors/:id`         | Read one monitor                                          |
| `PUT`  | `/api/queue-monitors/:id`         | Update monitor mode, runner, filters, and guardrails      |
| `GET`  | `/api/queue-monitors/:id/health`  | Read health and action item state                         |
| `GET`  | `/api/queue-monitors/:id/explain` | Build a fresh packet and planned action without mutation  |
| `POST` | `/api/queue-monitors/:id/run`     | Run one monitor now                                       |
| `POST` | `/api/queue-monitors/:id/pause`   | Pause one monitor                                         |
| `POST` | `/api/queue-monitors/:id/resume`  | Resume one monitor                                        |

### Update Example

```json
{
  "mode": "execute",
  "workflowId": "queue-intake-workflow",
  "sandboxPresetId": "codex-repo-contained",
  "repo": "BradGroux/veritas-kanban",
  "state": "open",
  "labels": ["priority: high"],
  "maxCandidates": 20,
  "stopConditions": {
    "maxFailureStreak": 3,
    "skipBlockedLabels": ["blocked", "needs-info"],
    "skipDraftPullRequests": true,
    "skipFailedChecks": true
  }
}
```

## Permissions

- `GET /api/queue-monitors`, `GET /:id/health`, and `GET /:id/explain` require `workflow:read`.
- `PUT /api/queue-monitors/:id`, pause, and resume require `workflow:write`.
- `POST /api/queue-monitors/:id/run` requires `workflow:execute`.

CLI permission preflight checks `/api/auth/context` before sending mutating requests.
