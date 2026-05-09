# Veritas Cutover Operating Guide

This guide records the Veritas Cutover authority model, QA gate, and task templates for GitHub-backed Veritas work. It resolves the operating artifacts requested in GitHub issues #319, #320, #321, #322, and #323.

## Authority Model

Veritas is the operational task board and source of truth for work state, ownership, acceptance criteria, progress evidence, and Done decisions.

HermesAgent and Hermes Gateway are the communication and control-plane spine for agent coordination.

Mission Control is a dashboard, display, and control surface only. It does not replace Veritas as the task source of truth.

GitHub is the only implementation, pull request, review, and CI evidence surface for production changes. Linear is historical-only. OpenClaw, `.openclaw`, and port `:18789` must not be used as active routing dependencies for cutover work.

Production work must follow this path before Done:

1. Create or confirm the GitHub issue.
2. Create a branch from the recorded base branch.
3. Implement the scoped change.
4. Run tests and any relevant runtime or browser smoke checks.
5. Open or update a pull request.
6. Record CI, review, and QA evidence on the Veritas task or linked GitHub issue.
7. Move to Done only after explicit QA evidence exists.

Do not reset, clean, or revert dirty repositories blindly. Report pre-existing repository dirt with exact file counts and work around it.

## Active Roster

| Owner | Ref            | Status    | Responsibility                                            |
| ----- | -------------- | --------- | --------------------------------------------------------- |
| Ops   | `hermes:ops`   | Active    | Authority model, routing, release readiness, repo hygiene |
| QA    | `hermes:qa`    | Active    | Test plan, QA evidence, reviewer gate, Done approval      |
| Rex   | `hermes:rex`   | Active    | Backend implementation and integration work               |
| Spark | `hermes:spark` | Active    | Product specs, acceptance criteria, task shaping          |
| Scout | `hermes:scout` | Active    | Research, revenue signal intake, source validation        |
| Bolt  | `hermes:bolt`  | Active    | Fast implementation chunks, automation, small fixes       |
| Dan   | `hermes:dan`   | On demand | Medik8 and customer-specific operational templates        |

Bench personas remain available for historical or future routing only: Dash, Sage, Tweak, Ada, Claudia, Flux, Archivist, Auditor, and Patch.

## Mandatory QA Gate

Every production task must include QA evidence before Done. If a task is documentation-only or planning-only, record that exemption explicitly.

Required evidence:

- GitHub repo and base branch.
- Branch or PR URL for implementation work.
- Test commands run and results.
- CI status for PR-backed work.
- Runtime, browser, or API smoke evidence when behavior changes.
- Reviewer sign-off for medium and high-risk changes.
- Final repository status, including any intentional dirty files or known pre-existing dirt.

TDD is required for production code changes unless the task records a clear exemption. The exemption must name why automated coverage is not practical and what compensating check was performed.

## Product And Spec Task Template

Use this template for GitHub-backed product or implementation work before writing code.

```markdown
## Problem

What user, operator, or system problem are we solving?

## Repository

- Repo:
- Base branch:
- Worktree:
- GitHub issue:
- Pull request:

## Scope

- In scope:
- Out of scope:

## Acceptance Criteria

- [ ] Observable behavior or artifact:
- [ ] Data/API/UI contract:
- [ ] Error or edge-case behavior:
- [ ] Documentation or migration note:

## Test Plan

- Unit:
- Integration:
- Runtime/browser/API smoke:
- CI:

## QA Gate

- Required reviewer:
- Evidence location:
- Done approval:

## Risk

- Risk level:
- Rollback plan:
- Follow-up tasks:
```

For larger work, split the task into chunks. Each chunk must be independently QA-complete before it is marked Done.

## Research And Revenue Intake Template

Use this template when a research or revenue signal needs to become QAable GitHub-backed work.

```markdown
## Signal

What happened, who said it, or what source produced the signal?

## Why It Matters

What user pain, market shift, operational gap, or revenue opportunity does this indicate?

## Money Path

- Buyer/user:
- Budget or value driver:
- Conversion path:
- Revenue risk or upside:

## Validation Speed

- Fastest validation step:
- Expected evidence:
- Time box:

## Effort

- Repo/path:
- Owner:
- Estimated size:
- Dependencies:

## Source Links

- Link:
- Link:

## Andy-Ready Decision

Recommendation:
Reason:
Next action:
Stop condition:
```

Do not route research intake through unsupported platforms. The output must point to a GitHub issue, PR, repo path, or documented decision artifact.

## Medik8 Task Template

Use this template for Dan-owned Medik8 work. It is intentionally stricter because of territory and customer-facing boundaries.

```markdown
## Medik8 Scope

- Request:
- Owner: Dan
- Repo/path:
- GitHub issue:
- Pull request:

## Territory Guardrail

This task is Cyprus-only. Do not make claims, publishing decisions, customer communications, pricing, payments, Zoho changes, credential changes, or distribution assumptions outside Cyprus.

## Approval-Gated Actions

- [ ] Customer-facing copy or communication
- [ ] Payments, pricing, invoices, refunds, or financial terms
- [ ] Zoho records, automations, imports, exports, or sync changes
- [ ] Publishing, launch, campaign, or public distribution
- [ ] Credential, token, account, or production configuration changes

No checked action may proceed without explicit human approval recorded in the GitHub issue or PR.

## Acceptance Criteria

- [ ] Cyprus-only guardrail is visible in the artifact.
- [ ] Approval-gated actions are listed and respected.
- [ ] QA evidence is attached.
- [ ] Final artifact path or PR URL is recorded.

## QA Evidence

- Test/review command:
- Runtime or artifact smoke:
- Reviewer:
- Approval link:
```

## Completion Comment Template

Use this closing note when an issue is completed:

```markdown
Completed in <PR or commit link>.

Evidence:

- Tests:
- CI:
- Reviewer/approval:
- Repo status:

Thanks to @<contributor> for the issue and direction.
```
