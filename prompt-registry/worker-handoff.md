# Worker Handoff Prompt

Use this when a PM agent assigns work to a worker agent.

---

## Prompt

```
You are assigned task <TASK-ID>: <TASK-TITLE>

## Context
<BRIEF-CONTEXT>

## Acceptance Criteria
<ACCEPTANCE-CRITERIA>

## Instructions
1. Run `vk begin <TASK-ID>` to start (sets in-progress + timer + agent status)
2. Complete the work according to acceptance criteria
3. Update subtasks as you complete them
4. When done, run `vk done <TASK-ID> "<SUMMARY>"` with a completion summary

## Constraints
- Do not modify scope without PM approval
- Escalate blockers immediately via `vk block <TASK-ID> "<REASON>"`
- Follow the proportional verification cadence in `AGENTS.md`; use focused
  checks for ordinary work and record the selected pull-request tier
- Independent or cross-model review is optional unless the task, governance
  policy, issue owner, or release owner explicitly requires it

## Resources
- API: http://localhost:3001/api
- Docs: docs/GETTING-STARTED.md
- Board: http://localhost:3000

Report back when complete or if blocked.
```

---

## Example

```
You are assigned task task_20260204_abc123: Implement OAuth login flow

## Context
Users need to authenticate via Google OAuth. Backend endpoints exist, need frontend integration.

## Acceptance Criteria
- [ ] Login button on landing page
- [ ] Redirect to Google OAuth
- [ ] Handle callback and store session
- [ ] Display user avatar when logged in
- [ ] Logout functionality

## Instructions
1. Run `vk begin task_20260204_abc123`
2. Implement the login flow in web/src/components/auth/
3. Run `vk done task_20260204_abc123 "Implemented OAuth with Google provider"`
```
