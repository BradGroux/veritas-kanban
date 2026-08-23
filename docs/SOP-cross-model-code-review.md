# Optional Independent Code Review Playbook

This legacy-path document describes an optional independent-review workflow.
It is not part of the default delivery SOP or release gate. Use it only when
the task, configured review gate, issue owner, or release owner explicitly
requests it.

---

## When to Trigger

| Work Type                        | Review Required?         |
| -------------------------------- | ------------------------ |
| Application code, infra, scripts | When explicitly required |
| Docs/content                     | When explicitly required |
| Research summaries               | When explicitly required |

If no review requirement is present, use focused self-verification and the
normal human/CI review path.

---

## Workflow

1. **Authoring task completes** (status remains `in-progress`).
2. **Create review task** referencing the original:
   - Title: `Review: <orig task title>`
   - Type: `code`
   - Sprint/project identical
   - Description includes acceptance criteria + diff link(s)
3. **Assign an independent reviewer** (human or configured agent):
   ```
   Hey Codex, review PR for task_1234. Checklist below.
   ```
4. **Reviewer steps**:
   - Pull branch / run tests (if applicable)
   - Use `docs/SOP-agent-task-workflow.md` for lifecycle
   - Log findings as subtasks or checklist entries
   - Severity tagging: High / Medium / Low / Nit
5. **Outcomes**:
   - ✅ No issues → comment summary + mark review task done → original task can go to `done`
   - ❌ Issues → create fix subtasks on original task, set status `blocked` until resolved
6. **Comms**: Reviewer leaves structured comment:
   ```
   ## Findings
   - [High] Path traversal (see notes)
   - [Low] Missing aria-label
   ## Verdict
   Changes required.
   ```
7. **Audit trail**: Record the reviewer and outcome in the task or pull request
   when attribution is required by the configured policy.

---

## Review Checklist

| Category          | Questions                                                        |
| ----------------- | ---------------------------------------------------------------- |
| **Security**      | Auth enforced? Input validated? Path traversal? Secrets handled? |
| **Reliability**   | Error handling? Race conditions? Timeouts? File locking?         |
| **Performance**   | Avoid O(n²)? Streaming vs buffering? Caching appropriate?        |
| **Accessibility** | Keyboard support? aria-labels? Color contrast?                   |
| **Docs**          | README/docs updated? Migration notes? Tests updated?             |

Adapt per task type.

---

## Prompt Template (Reviewer)

```
You are the independent reviewer. Apply the checklist:
1. Pull latest branch <branch>.
2. Run tests (if any).
3. For each issue, note severity (High/Medium/Low/Nit) + file/line + fix suggestion.
4. Summarize verdict: Approve or Changes Required.
5. Update task <id> with findings and completion summary.
```

Store in `prompt-registry/cross-model-review.md`.

---

## Recording Findings

- Add subtasks under the original task for each confirmed bug.
- Reference GitHub issues if they existed.
- Use Lessons Learned to capture systemic insights (e.g., “Always use withFileLock() when touching JSON stores”).

---

## Escalation

| Scenario                                        | Action                                            |
| ----------------------------------------------- | ------------------------------------------------- |
| Reviewer disagrees with author but fix is minor | Leave comment + request change.                   |
| Reviewer finds high severity bug                | Block task, ping human immediately.               |
| Author disputes reviewer findings               | Create triage meeting or ask human to adjudicate. |

---

## Review Gates (Veritas Kanban Enforcement)

VK's built-in enforcement gates can make this optional playbook a structural
requirement for selected workspaces or tasks:

1. **reviewGate** — Blocks task completion unless all four reviewScores (security, reliability, performance, accessibility) are 10. This is the automated enforcement layer that ensures the configured review checklist has been completed rigorously.

2. **closingComments** — Requires a substantive review comment (≥20 characters) before task completion. Ensures the reviewer leaves documented findings, not just scores.

3. **How they work together**:
   - Author (Model A) completes code; task remains `in-progress`
   - Independent reviewer runs the configured review checklist
   - Reviewer scores all 4 dimensions via the API: `PATCH /api/tasks/{id}` with `reviewScores`
   - Reviewer leaves findings as comments (must be ≥20 chars if closingComments enabled)
   - If reviewGate is enabled, task **cannot** move to `done` until all scores are 10
   - If closingComments is enabled, at least one substantive comment is required

4. **Enabling gates**:

   ```bash
   curl -X PATCH http://localhost:3001/api/settings/features \
     -H 'Content-Type: application/json' \
     -d '{"enforcement": {"reviewGate": true, "closingComments": true}}'
   ```

5. **Handling gate failures** — If task completion returns a 400 error with `REVIEW_GATE_FAILED` or `CLOSING_COMMENT_REQUIRED`, the reviewer must address the deficiency (raise a score, add a comment) and retry.

6. **Recommendation**: Enable `reviewGate` and `closingComments` only when the
   workspace deliberately requires independent scored review. Leave them off
   when normal task verification and human/CI review are sufficient.

7. Full documentation: See [Enforcement Gates](enforcement.md) for all available gates, configuration options, and API reference.

---

RF-002 recorded a 91% accuracy rate for this review method. That result supports
using the method when selected; it does not make it a universal gate.
