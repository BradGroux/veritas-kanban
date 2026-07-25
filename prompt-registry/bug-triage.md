# Bug Triage Prompt

Use this for investigating and fixing bugs.

---

## Prompt

````
Investigate and fix bug: <BUG-TITLE>

## Task
<TASK-ID>

## Reported Behavior
<WHAT-HAPPENS>

## Expected Behavior
<WHAT-SHOULD-HAPPEN>

## Reproduction Steps
<STEPS-TO-REPRODUCE>

## Investigation Approach

1. **Reproduce** — Confirm the bug exists
2. **Locate** — Find the root cause (not just symptoms)
3. **Understand** — Why does this happen?
4. **Fix** — Implement the minimal correct fix
5. **Verify** — Confirm the fix works and doesn't break other things
6. **Prevent** — Add test to prevent regression

## Deliverables
- [ ] Root cause identified
- [ ] Fix implemented
- [ ] Regression test added (if applicable)
- [ ] Related areas checked for similar issues
- [ ] Touched packages type-check and the focused regression test passes

Follow the verification cadence in `AGENTS.md`. Do not run the complete
workspace suite unless deterministic CI selects it or this is an explicit
integration, critical-security, or release milestone.

## Workflow
```bash
vk begin <TASK-ID>
# ... investigate and fix ...
pnpm --filter <TOUCHED-PACKAGE> typecheck
pnpm --filter <TOUCHED-PACKAGE> test -- <FOCUSED-TEST>
vk done <TASK-ID> "Fixed: <ROOT-CAUSE>. Solution: <SUMMARY>"
````

## Tips

- Check server logs: `tail -f server/logs/*.log`
- Check browser console for frontend issues
- Use `git blame` to understand when behavior changed
- Search codebase for similar patterns that might have same bug

```

---

## Example

```

Investigate and fix: Archive button returns "Archive failed" error

## Reported Behavior

Clicking "Archive" on a task shows toast: "Archive failed"

## Expected Behavior

Task should move to archive

## Reproduction Steps

1. Open any task detail panel
2. Click "Archive" button
3. Observe error toast

## Root Cause (after investigation)

taskToFilename() generates filename from current title, but actual file on disk
has different slug if title changed after creation. fs.rename() fails with ENOENT.

## Fix

Added findTaskFile() helper that searches by task ID prefix instead of computing filename.

```

```
