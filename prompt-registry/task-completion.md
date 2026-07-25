# Task Completion Prompt

Use this as a checklist before marking any task done.

---

## Prompt

````
Complete task <TASK-ID>: <TASK-TITLE>

## Pre-Completion Checklist

### Work Quality
- [ ] All acceptance criteria met
- [ ] All subtasks completed
- [ ] Touched packages type-check without errors
- [ ] Focused tests cover the changed behavior and high-risk edges
- [ ] The pull request records the selected verification tier and justification
- [ ] No console errors or warnings

### Documentation
- [ ] Code comments explain non-obvious logic
- [ ] README updated if user-facing change
- [ ] CHANGELOG entry added if notable

### Review
- [ ] Self-reviewed the diff
- [ ] Any review explicitly required by the task, governance policy, issue
      owner, or release owner is complete
- [ ] No TODO comments left unresolved

### Cleanup
- [ ] No debug code or console.logs
- [ ] No commented-out code blocks
- [ ] Imports organized

## Completion Summary Format

Write a brief summary covering:
1. **What** — What was done
2. **How** — Technical approach (if relevant)
3. **Testing** — How it was verified
4. **Notes** — Anything the next person should know

## Workflow
```bash
# Run the narrowest useful verification from AGENTS.md
pnpm --filter <TOUCHED-PACKAGE> typecheck
pnpm --filter <TOUCHED-PACKAGE> exec vitest run <FOCUSED-TEST>

# Complete the task
vk done <TASK-ID> "<SUMMARY>"
````

Do not rerun unchanged passing gates after documentation, comment, or
formatting-only edits. The complete workspace suite belongs to deterministic CI
escalation or an explicit integration, critical-security, or release milestone.

```

---

## Example Summary

```

Implemented OAuth login flow:

- Added GoogleOAuthButton component with redirect handling
- Integrated with existing auth context
- Tested login/logout cycle manually + added e2e test
- Note: Refresh token rotation not implemented (tracked in #123)

```

```
