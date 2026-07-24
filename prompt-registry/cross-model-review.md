# Cross-Model Code Review Prompt

Use this when a task or configured governance policy explicitly requires an
opposite-model review.

This prompt is optional unless the task, issue owner, release owner, or review
gate says otherwise.

---

## Prompt

```
Review the code changes for task <TASK-ID>: <TASK-TITLE>

## Files Changed
<FILE-LIST-OR-DIFF>

## Review Checklist

### Security
- [ ] No hardcoded secrets or API keys
- [ ] Input validation on all user-supplied data
- [ ] Path traversal prevention (validatePathSegment)
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (output encoding)
- [ ] Authentication/authorization checks present

### Reliability
- [ ] Error handling for all failure modes
- [ ] No race conditions in async code
- [ ] Resource cleanup (file handles, connections)
- [ ] Graceful degradation when dependencies fail

### Performance
- [ ] No N+1 queries
- [ ] Appropriate caching
- [ ] No memory leaks
- [ ] Pagination for large datasets

### Code Quality
- [ ] Types are correct and complete
- [ ] No unused imports or dead code
- [ ] Consistent naming conventions
- [ ] Comments explain "why" not "what"

## Output Format

For each finding:
```

**[SEVERITY] Category: Brief description**
File: path/to/file.ts:LINE
Issue: What's wrong
Fix: Suggested remediation

```

Severity levels: CRITICAL, HIGH, MEDIUM, LOW, INFO

If no issues found, respond: "✅ Code review passed — no issues found."
```

---

## Reference

See RF-002 cross-model audit for validation of this approach (91% accuracy).
