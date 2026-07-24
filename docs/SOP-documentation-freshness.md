# SOP: Documentation Freshness

> "Stale docs = hallucinating AI." — Monika Voutov

Keep project documentation current as the codebase evolves.

---

## Why It Matters

AI agents rely on documentation to understand context, conventions, and constraints. Outdated docs cause:

- Incorrect assumptions about architecture
- Repeated mistakes that were already solved
- Inconsistent code patterns
- Wasted time re-discovering known issues

---

## Core Documents

Every project should maintain these files:

| File                     | Purpose                                | Update Cadence                       |
| ------------------------ | -------------------------------------- | ------------------------------------ |
| `AGENTS.md`              | Canonical agent rules and architecture | After toolchain/architecture changes |
| `CLAUDE.md`              | Claude-specific supplement             | When Claude behavior differs         |
| `docs/BEST-PRACTICES.md` | Team patterns and anti-patterns        | Monthly or after post-mortems        |
| `prompt-registry/*.md`   | Workflow prompts                       | When prompts drift or improve        |
| `README.md`              | Project overview, quick start          | After major releases                 |

### Optional Model-Specific Files

- `GPT.md` — GPT-specific notes (if behavior differs from Claude)
- `GEMINI.md` — Gemini-specific notes
- `CODEX.md` — Codex-specific notes

---

## Update Triggers

### Immediate Updates

Update docs **within the same session** when:

1. **A bug was caused by missing context** — Add durable shared context to
   `AGENTS.md`, or a harness-specific supplement when it truly differs
2. **Cross-model review catches a pattern** — Document the pattern
3. **A workaround is discovered** — Add it to Troubleshooting or the nearest
   applicable instruction file
4. **API behavior changes** — Update relevant docs

### Scheduled Updates

Review docs on a regular cadence:

| Cadence     | Action                                                     |
| ----------- | ---------------------------------------------------------- |
| Weekly      | Skim task "Lessons Learned" fields, propagate to CLAUDE.md |
| Monthly     | Full freshness audit (see checklist below)                 |
| Per release | Update README, CHANGELOG, migration guides                 |

---

## Freshness Audit Checklist

Run this monthly or after major releases:

```markdown
## Doc Freshness Audit — [DATE]

### CLAUDE.md

- [ ] "Last updated" date is within 30 days
- [ ] Architecture section matches current code structure
- [ ] Common mistakes section includes recent learnings
- [ ] No outdated file paths or removed features

### BEST-PRACTICES.md

- [ ] All "Do This" items are still valid
- [ ] All "Don't Do This" items reflect real issues
- [ ] No references to deprecated workflows

### prompt-registry/

- [ ] Prompts reference current API endpoints
- [ ] No prompts for removed features
- [ ] Cross-model review prompt matches current checklist

### README.md

- [ ] Quick start instructions work on clean install
- [ ] Badge/version numbers are current
- [ ] Screenshots match current UI

### SOPs (docs/SOP-\*.md)

- [ ] Workflows match current implementation
- [ ] CLI commands are correct
- [ ] API examples return expected responses
```

---

## Automation Plan (Future)

### Phase 1: Manual with Reminders (Current)

- Monthly calendar reminder for freshness audit
- Task "Lessons Learned" field captures immediate learnings
- Sprint retrospectives include doc review

### Phase 2: Commit-Triggered Suggestions

Use a git hook or CI job to flag potentially stale docs:

```bash
# .git/hooks/post-commit (concept)
#!/bin/bash

# Check if changed files might affect docs
changed_files=$(git diff --name-only HEAD~1)

if echo "$changed_files" | grep -q "server/src/routes"; then
  echo "⚠️  Routes changed — consider updating API docs"
fi

if echo "$changed_files" | grep -q "server/src/services"; then
  echo "⚠️  Services changed — consider updating CLAUDE.md architecture section"
fi
```

### Phase 3: Doc Steward Agent

A dedicated agent task type that:

1. Runs weekly (cron or heartbeat)
2. Summarizes recent commits: `git log --oneline --since="1 week ago"`
3. Compares against doc sections
4. Creates a task with suggested updates

**Prompt template:**

```markdown
You are a Documentation Steward for Veritas Kanban.

## Recent Changes

[INSERT GIT LOG]

## Current CLAUDE.md

[INSERT CURRENT FILE]

## Task

1. Identify changes that might require doc updates
2. For each, suggest specific edits
3. Output as a markdown checklist

Focus on:

- New files/services not mentioned in architecture
- Changed APIs not reflected in examples
- Bug fixes that should be added to "Common Mistakes"
```

### Phase 4: Automated PR Comments

GitHub Action that:

1. Triggers on PR
2. Uses AI to compare diff against relevant docs
3. Comments on PR if docs might need updates

---

## Integration with VK

### Task Type: `docs`

Use the `docs` task type for documentation work:

```bash
vk create "Update CLAUDE.md after auth refactor" --type docs --priority high
```

### Lifecycle Hook: onCompleted

Configure a hook to remind about docs after task completion:

```json
{
  "hooks": {
    "enabled": true,
    "onCompleted": {
      "enabled": true,
      "webhook": "https://your-reminder-service.com/doc-check"
    }
  }
}
```

---

## Credit

Documentation freshness pattern inspired by [BoardKit Orchestrator](https://github.com/BoardKit/orchestrator) by Monika Voutov.
