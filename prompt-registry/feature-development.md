# Feature Development Prompt

Use this for end-to-end feature implementation.

---

## Prompt

````
Implement feature: <FEATURE-TITLE>

## Task
<TASK-ID>

## Requirements
<REQUIREMENTS>

## Technical Context
- Stack: <TECH-STACK>
- Relevant files: <FILE-PATHS>
- Related features: <REFERENCES>

## Implementation Steps

1. **Understand** — Read the requirements and existing code
2. **Plan** — Outline the approach (update task description with plan)
3. **Implement** — Write the code in small, testable increments
4. **Test** — Verify functionality works as expected
5. **Document** — Update relevant docs/comments

## Deliverables
- [ ] Working implementation
- [ ] Unit tests (if applicable)
- [ ] Updated documentation
- [ ] Completion summary

## Constraints
- Follow existing code patterns in the codebase
- All new endpoints need auth middleware
- Changes affecting shared types go in `shared/src/`
- Follow the verification cadence in `AGENTS.md`: type-check touched packages
  and run focused regression tests during ordinary implementation
- Run the complete workspace suite only when deterministic CI selects it or at
  an explicit integration, critical-security, or release milestone

## Workflow
```bash
vk begin <TASK-ID>
# ... implement ...
pnpm --filter <TOUCHED-PACKAGE> typecheck
pnpm --filter <TOUCHED-PACKAGE> test -- <FOCUSED-TEST>
vk done <TASK-ID> "Implemented <FEATURE>: <SUMMARY>"
````

```

---

## Example

```

Implement feature: Task time tracking

## Task

task_20260204_xyz789

## Requirements

- Start/stop timer per task
- Track total time across sessions
- Display in task detail panel
- CLI commands: vk time start/stop/show

## Technical Context

- Stack: React + Express + TypeScript
- Relevant files: server/src/services/task-service.ts, web/src/components/task/
- Related features: Task status updates

```

```
