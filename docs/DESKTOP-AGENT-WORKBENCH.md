# Post-GA Desktop Agent Workbench Spec

Status: accepted for post-GA planning.

Issue: [#545](https://github.com/BradGroux/veritas-kanban/issues/545)

Date: 2026-06-04

## Purpose

The desktop agent workbench is a post-GA operator surface for daily agent-heavy
work: watching runs, reviewing evidence, approving gated actions, refining work
products, and handling handoffs without losing the safety boundaries established
for v5 desktop, workflow, policy, and remote/mobile access.

This is not part of v5 Mac GA. The GA desktop shell remains focused on local
server lifecycle, packaging, remote access, PWA/mobile support, SQLite, release
readiness, and existing workflow/task surfaces.

## Product Decision

Build the workbench as a desktop-first control surface over existing Veritas
server authority. The desktop app may add native menus, notifications, deep
links, diagnostics, window layout, and safe local affordances, but workflow run
state, approvals, audit, work products, policy decisions, and task state remain
server-owned.

The workbench should make complex agent work easier to operate, not give the
renderer broad local powers. Terminal/log panes stream scoped run output and
diagnostics. They are not generic shell access unless a future explicitly
approved interactive-session feature adds a server-side policy gate, audit
trail, and desktop-only confirmation flow.

## Goals

- Give operators one dense, desktop-friendly surface for active runs, approvals,
  evidence, logs, work products, handoffs, and diagnostics.
- Make run controls clear, reversible where possible, and audited.
- Show why an approval is needed before asking for a decision.
- Support replay and refinement without destroying original evidence.
- Make orchestrator/subagent fan-out visible enough for daily use.
- Keep desktop-only, remote-safe, mobile-safe, and admin-only actions explicit.
- Define regression coverage before implementation.

## Non-Goals

- Shipping the workbench in v5 Mac GA.
- Replacing the existing board, task detail, Workflow page, or work-product
  APIs.
- Giving the renderer generic filesystem, process, shell, Keychain, or server
  log access.
- Allowing mobile or PWA clients to run desktop-only controls.
- Allowing approvals without current permission, current evidence, and an audit
  record.
- Running Git, shell, deployment, cleanup, import/export, or destructive
  actions without explicit policy and confirmation.

## Information Architecture

The workbench is a first-class desktop route and native menu target:

```text
Agent Workbench
  Overview
    - active runs
    - blocked approvals
    - failed/retryable runs
    - stale agents
    - recent work products
    - diagnostics summary
  Run Detail
    - run header and control bar
    - timeline
    - orchestrator/subagent graph
    - step logs and terminal output
    - evidence and artifacts
    - approvals and policy decisions
    - replay/refine actions
  Approval Center
    - pending approvals
    - stale/expired approvals
    - recently decided approvals
    - delegated approval state
  Evidence Library
    - work products
    - completion packets
    - QA evidence
    - policy and decision traces
  Handoffs
    - task handoff packets
    - reviewer queues
    - failed-run recovery briefs
  Diagnostics
    - desktop connection state
    - server health
    - agent registry
    - webhook/Squad Chat health
    - redacted logs and debug bundle actions
```

## Core Views

### Overview

The overview is optimized for scanning and repeated operation. It should show:

- Active run count by status: running, blocked, failed, retrying, completed.
- Pending approvals grouped by risk and age.
- Failed or retryable runs with the next safe action.
- Agents offline, stale, busy, or blocked.
- Workflow health and queue depth.
- Latest generated work products that need review.
- Desktop connection mode and health.

The overview should not include marketing copy, onboarding explanation, or
decorative panels. It is an operator console.

### Run Detail

Run detail is the main work surface.

Required regions:

- Header: task, workflow, run id, actor, client mode, status, started time,
  duration, policy posture, and current step.
- Control bar: allowed run actions for the current actor and client mode.
- Timeline: step events, retries, policy decisions, approval requests, work
  products, and completion packets.
- Orchestrator graph: parent agent, subagents, role contracts, dependencies,
  active step, elapsed time, token/time budgets when available, and handoff
  state.
- Log panes: step log, agent output, progress file, policy trace, and redacted
  diagnostics.
- Evidence: produced files, work products, diffs, screenshots, test output,
  links, and acceptance criteria.
- Approval drawer: current approval request with evidence, risk, options, and
  stale-state warnings.

The control bar must be stable. Controls should stay in fixed positions and
switch disabled/loading states instead of shifting layout as run status changes.

### Approval Center

Approval Center is the place for cross-task gated decisions.

Each approval card must show:

- requesting actor and agent permission level.
- task, workflow, run, step, and workspace.
- requested action and action class.
- risk reason and policy that required approval.
- exact scope: files, task, workflow, work product, token, deployment, cleanup,
  or integration target.
- evidence summary and link to full evidence.
- current freshness state.
- approve, reject, request changes, or open run controls allowed by role.

Dangerous approvals require fresh auth and explicit confirmation. Stale
approvals must not be silently approved.

### Evidence Library

Evidence Library collects durable proof and generated outputs:

- work-product previews and versions.
- completion packets.
- policy decision traces.
- verification logs.
- redaction state.
- source task/run links.
- reviewer notes.

Refinement creates a new work-product version. It must not overwrite original
run evidence.

### Handoffs

Handoff views turn run output into reviewable work:

- Operator handoff: current status, blockers, changed files, verification,
  remaining risks, and next action.
- Reviewer handoff: acceptance criteria, evidence, QA status, diffs, and
  approval state.
- Recovery handoff: failed step, last known safe state, retry constraints,
  logs, and recommended recovery path.

Handoffs are work products or task-linked records, not transient UI-only text.

### Diagnostics

Workbench diagnostics are redacted by default and should link to existing
Maintenance Center and Settings health surfaces.

Show:

- desktop app version, server version, client mode, origin label, and update
  channel.
- server health, readiness, storage, WebSocket, and workflow queue health.
- agent registry and stale heartbeat summary.
- communication health: Squad Chat, webhook, notification, and failure-alert
  status.
- redacted log tail and debug-bundle preview.

Do not show:

- raw tokens, cookies, API keys, recovery keys, webhook secrets, private URLs
  with query strings, raw local paths from another user, or unredacted task/work
  content by default.

## Run Controls

Run controls are server-authoritative actions surfaced through desktop UI and
optional native menu shortcuts.

| Control                   | Default class                                            | Requirements                                                              |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Open run                  | Mobile-safe                                              | Read permission and current workspace access.                             |
| Copy run link             | Mobile-safe                                              | Link must not contain credentials or query secrets.                       |
| Pause run                 | Remote-safe                                              | Run must support pausing; audit actor and reason.                         |
| Resume blocked run        | Remote-safe                                              | Approval or gate condition must still be current.                         |
| Retry failed step         | Remote-safe                                              | Retry policy allows it; show failed evidence and current inputs.          |
| Cancel run                | Remote-safe, approval-required for high-risk runs        | Confirm when side effects may already exist; audit.                       |
| Escalate to human         | Remote-safe                                              | Creates task/run event and notification.                                  |
| Reassign agent            | Admin-only or workflow-admin                             | Requires workflow permission and audit.                                   |
| Replay run                | Remote-safe for dry-run, admin-only for effectful replay | Must snapshot inputs and policy; never overwrite original evidence.       |
| Open local worktree       | Desktop-only                                             | Requires local desktop mode and opaque server-approved reference.         |
| Show artifact in folder   | Desktop-only                                             | Uses typed bridge with opaque artifact ref.                               |
| Create debug bundle       | Desktop-only or admin-only depending scope               | Redacted preview before export.                                           |
| Delete generated artifact | Admin-only, destructive                                  | Explicit confirmation and audit.                                          |
| Run shell/Git/deploy      | Execution-only, desktop-only if ever exposed             | Out of first workbench phase unless separate approved policy gate exists. |

Controls that are unavailable in the current client mode should explain why
without exposing hidden capabilities.

## Action Class Matrix

| Action area                            | Desktop local                 | Desktop remote            | Browser/PWA               | Native mobile                           | Admin requirement                   |
| -------------------------------------- | ----------------------------- | ------------------------- | ------------------------- | --------------------------------------- | ----------------------------------- |
| View run timeline and evidence         | Allowed                       | Allowed                   | Allowed                   | Allowed read-only summaries             | Role-based read.                    |
| Approve normal gate                    | Allowed                       | Allowed                   | Allowed                   | Online only if mobile-safe approval     | Reviewer/member/admin by policy.    |
| Approve destructive or privileged gate | Allowed with fresh auth       | Allowed with fresh auth   | Allowed with fresh auth   | Not mobile-safe                         | Admin/owner or named approver.      |
| Pause/resume/retry/cancel run          | Allowed by policy             | Allowed by policy         | Allowed by policy         | Online only when explicitly mobile-safe | Depends on workflow policy.         |
| Replay dry-run                         | Allowed                       | Allowed                   | Allowed                   | Not mobile-safe                         | Workflow execute permission.        |
| Replay effectful run                   | Confirmation required         | Confirmation required     | Confirmation required     | Not mobile-safe                         | Admin/workflow-admin.               |
| Open local worktree or artifact folder | Desktop-only                  | Not available             | Not available             | Not available                           | Local desktop plus permission.      |
| Create debug bundle                    | Desktop-only for local bundle | Remote server bundle only | Remote server bundle only | Not mobile-safe                         | Admin for deep diagnostics.         |
| Configure agents/policies/webhooks     | Online only                   | Online only               | Online only               | Not mobile-safe                         | Admin/owner.                        |
| Rotate tokens or revoke devices        | Online only                   | Online only               | Online only               | Not mobile-safe                         | Admin/owner.                        |
| Shell/Git/deploy operation             | Out of first phase            | Out of first phase        | Out of first phase        | Never mobile-safe                       | Separate approved execution policy. |

## Safety Model

### Authority

- Server owns task, workflow, approval, audit, policy, work-product, and run
  state.
- Desktop main process owns native window/menu/deep-link/notification behavior
  and local server supervision.
- Renderer owns UI state only.
- The preload bridge stays allowlisted and typed as defined in ADR 0001.

### Approval Boundaries

Approvals must be blocked when:

- actor no longer has permission.
- approval is stale, expired, already decided, or points to a changed step.
- evidence required by policy is missing.
- requested action class is not available in current client mode.
- run/workflow/task was deleted, archived, moved, or changed policy scope.
- approval would grant a broader action than the displayed request.

Every approval decision records actor, role, client mode, request id, task, run,
step, policy id, evidence version, decision, reason, and timestamp.

### Evidence Boundaries

- Original run logs and policy decisions are immutable evidence.
- Refined work products create versions.
- Redacted previews are the default for sensitive products.
- Copy/download/export actions must follow work-product redaction metadata.
- Evidence links must not contain bearer tokens, raw local private paths, or
  credential-bearing query strings.

### Terminal And Log Boundaries

- Log panes are read-only by default.
- The renderer never receives a raw process handle or unrestricted pty.
- Interactive terminal input is out of first phase.
- If interactive input is added later, it must be desktop-only, policy-gated,
  audited, scoped to a known run/worktree, and covered by fresh confirmation.
- Copying logs should apply the same redaction used for support bundles.

### Native Menu, Notification, And Deep-Link Boundaries

- Native menu shortcuts may navigate, focus views, copy safe links, or trigger
  already-visible allowed controls.
- Native notification actions carry opaque ids only and call the server for the
  current state before acting.
- Deep links open run/task/work-product context; they do not execute approvals
  or run controls directly.
- Remote origins never receive local desktop bridge powers by default.

## Native Menu And Shortcut Targets

Initial safe targets:

- Open Agent Workbench.
- Open active runs.
- Open Approval Center.
- Open last notification target.
- Copy current run/task link.
- Focus log search.
- Create redacted debug bundle preview.

Unsafe or deferred targets:

- Approve/reject from a native notification without opening evidence.
- Stop/retry/replay from a global shortcut.
- Open local worktree from remote mode.
- Run shell, Git, deploy, cleanup, import/export, token rotation, or webhook
  edits from a menu shortcut.

## Notifications And Deep Links

Notifications should be high-signal:

- run blocked for approval.
- run failed and is retryable.
- run completed with evidence ready.
- assigned review needs action.
- agent stale/offline during an active run.
- debug bundle created or failed.

Notification payloads must contain only opaque ids and coarse labels. The app
fetches current details after focus and auth checks.

Deep links should resolve:

- `veritas://run/<runId>`
- `veritas://task/<taskId>`
- `veritas://approval/<approvalId>`
- `veritas://work-product/<productId>`

Deep links must not contain tokens, recovery keys, webhook secrets, raw prompts,
or raw work-product content.

## Regression Coverage Required Before Implementation Ships

### Unit And Service Tests

- Run-control permission matrix by role, client mode, run state, and action
  class.
- Approval freshness and stale evidence rejection.
- Replay input snapshot and original evidence immutability.
- Work-product refinement creates versions and preserves source provenance.
- Redaction for log copy, evidence preview, debug bundle, and notification
  payloads.
- Policy decision audit for approve/reject/retry/cancel/replay.

### Web Component Tests

- Control bar keeps stable layout while controls load/disable.
- Disabled controls show the correct client-mode or permission reason.
- Approval cards show actor, action class, scope, policy reason, evidence, and
  freshness.
- Evidence Library does not render sensitive content when redacted.
- Handoff views render task/run/work-product provenance.

### Desktop Tests

- Preload bridge exposes only approved workbench calls and events.
- Native menu opens/focuses workbench routes without executing dangerous
  actions.
- Notification actions refetch current server state before acting.
- Desktop local-only actions are hidden or disabled in remote mode.
- Debug bundle preview redacts tokens, cookies, local private paths, and user
  content by default.

### End-To-End Smokes

- Active run opens from Workbench and streams timeline/log updates.
- Blocked approval cannot be approved after the run advances.
- Failed run retry shows evidence and records an audit event.
- Work product refine creates a new version and keeps the original.
- Mobile/PWA viewport cannot access desktop-only controls.
- Admin-only controls are unavailable to member/reviewer/read-only actors.

## Implementation Phases

1. Add shared action-class and run-control metadata so UI, API, and tests use
   the same permission vocabulary.
2. Build Workbench Overview from existing workflow, approval, agent, work
   product, notification, and diagnostics endpoints.
3. Add Run Detail control bar and evidence panes without new native powers.
4. Add Approval Center with freshness checks and evidence-first decisions.
5. Add Evidence Library and handoff work-product views.
6. Add desktop native menu and notification projections for navigation only.
7. Add desktop-only artifact/debug-bundle affordances through typed bridge refs.
8. Add replay/refine flows after evidence immutability and audit tests pass.
9. Revisit interactive terminal input only through a separate approved design.

## Open Questions For Implementation

- Whether run-control metadata should live entirely in API responses or in a
  shared client/server policy package.
- Whether replay should be workflow-level only or also support step-level replay
  for selected step types.
- Which work-product kinds should support side-by-side diff in the first phase.
- Whether desktop should support a detached Workbench window or keep it inside
  the main app window initially.
- What fresh-auth mechanism is acceptable for high-risk approvals in local
  desktop mode.

## Release Gate

The workbench should not leave beta until:

- action-class metadata exists for every visible control.
- desktop-only, remote-safe, mobile-safe, and admin-only behavior is covered by
  tests.
- approval decisions are stale-safe and audited.
- evidence and work-product refinement preserve provenance.
- debug/log surfaces use redaction by default.
- desktop native menu and notification actions cannot bypass visible approval
  boundaries.
