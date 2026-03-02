# Documentation Freshness Guide

> "Stale docs = hallucinating AI." — Monika Voutov, BoardKit Orchestrator

VK is agent-first. When docs are wrong, agents make wrong decisions. This guide ensures project documentation stays current.

## Doc Steward Workflow

### When to Update Docs

| Trigger                      | What to Update                          |
| ---------------------------- | --------------------------------------- |
| New API endpoint added       | README API section, relevant route docs |
| Schema change (shared/types) | Type documentation, API examples        |
| New CLI command              | CLI README, help text                   |
| Config option added/changed  | Settings docs, example configs          |
| New feature shipped          | README features section, changelog      |
| Architecture change          | Architecture docs, diagrams             |
| Bug fix with user impact     | Known issues, changelog                 |
| Dependency upgrade           | Requirements section if version matters |

### Doc Update Checklist

When completing a task that changes user-facing behavior:

- [ ] README.md updated (if applicable)
- [ ] API route documented (JSDoc + route comments)
- [ ] CLI help text accurate
- [ ] Type documentation matches implementation
- [ ] CHANGELOG.md updated
- [ ] Examples/templates still work
- [ ] AGENTS-TEMPLATE.md updated (if agent-facing API changed)

### Where Docs Live

| Doc                                | Purpose                  | Owner           |
| ---------------------------------- | ------------------------ | --------------- |
| `README.md`                        | Public-facing overview   | Any contributor |
| `docs/`                            | Detailed guides & specs  | Feature author  |
| `CHANGELOG.md`                     | Release history          | Release manager |
| `docs/AGENTS-TEMPLATE.md`          | Agent integration guide  | Agent team      |
| `docs/multi-agent-git-workflow.md` | Multi-agent coordination | Agent team      |
| JSDoc in source files              | API contracts            | Feature author  |

### Freshness Indicators

Each doc should include a freshness header:

```markdown
<!-- doc-freshness: 2026-03-02 | v3.3.3 | @tars -->
```

Format: `date | version | last-updater`

When a doc is older than the current version, it may need review.

## Automation Plan

### Phase 1: Manual (Current)

- Doc update checklist in PR template
- Freshness headers in docs
- Agent instructions include "update docs" step

### Phase 2: Hook-Based

- Lifecycle hook on `task.done` checks for doc-related files
- If code changes but no doc changes, create a follow-up task
- Use `docs/` path detection in git diff

### Phase 3: AI-Powered Doc Steward

- Dedicated "doc steward" agent type
- Subscribes to all `task.done` events
- Reads recent commits, identifies doc gaps
- Creates tasks with specific update suggestions
- Low-priority, runs during idle time

### Hook Configuration

```bash
# Create a doc freshness hook
curl -X POST /api/hooks -d '{
  "name": "Doc freshness check on completion",
  "event": "task.done",
  "action": "custom",
  "config": {
    "customAction": "check_doc_freshness",
    "description": "Verify docs were updated if code changed"
  }
}'
```

## Repo Rules (CLAUDE.md Equivalent)

VK's `docs/AGENTS-TEMPLATE.md` serves as the agent instruction file. Key rules:

1. **Always update docs alongside code** — no code-only PRs for user-facing changes
2. **Use freshness headers** — every doc starts with `<!-- doc-freshness: ... -->`
3. **JSDoc is documentation** — route handlers and services must have JSDoc
4. **Examples must work** — if you change an API, update the examples
5. **CHANGELOG is mandatory** — every release gets an entry

## Credit

This approach is inspired by [Monika Voutov's BoardKit Orchestrator](https://github.com/BoardKit/orchestrator), which emphasizes that documentation quality directly impacts AI agent reliability. Credit: @mvoutov
