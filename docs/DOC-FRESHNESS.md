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

The Settings → Doc Freshness registry is the authoritative freshness source.
Each tracked record stores its path, last review date, reviewer, maximum age,
tags, and notes. The service computes scores and alerts from those records; it
does not scan or rewrite Markdown headers.

A maintained living document may also include this optional human-readable
marker when repository reviewers find it useful:

```markdown
<!-- doc-freshness: 2026-03-25 | v4.0.0 | @veritas -->
```

Format: `date | version | last-updater`

The optional marker is not required for release notes, historical evidence,
generated references, or every file under `docs/`. When a tracked document is
older than its configured maximum age or its maintained version, review it and
update the authoritative registry record.

### Last Sweep

| Date       | Scope                                                               | Agent   |
| ---------- | ------------------------------------------------------------------- | ------- |
| 2026-08-24 | v6.1.2 audit, storage, provider, CI, security, release, distribution, and SOP docs | Release |
| 2026-08-22 | v6.1.1 maintenance, dependency, release, upgrade, and evidence docs | Release |
| 2026-07-26 | v6.1.0 roadmap, harness, governance, knowledge, and release docs    | Release |
| 2026-07-24 | v6.0.2 desktop recovery, version support, release, and evidence     | Release |
| 2026-07-24 | v6.0.1 stabilization, release, upgrade, API, MCP, and evidence      | Release |
| 2026-07-24 | v6.0.0 harness, Buzz, release, upgrade, compatibility, and evidence | Release |
| 2026-07-12 | v5.2.2 UI-audit fixes, release gates, desktop state, and evidence   | Release |
| 2026-06-05 | v5.0.0 stable release docs, install paths, release assets, RC notes | Codex   |
| 2026-03-25 | Full v3→v4 version references, governance docs, CHANGELOG, examples | VERITAS |
| 2026-03-21 | v4.0 release documentation                                          | TARS    |

## Automation Plan

### Phase 1: Manual (Current)

- Doc update checklist in PR template
- Doc Freshness registry records, with optional source markers where useful
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

## Repo Rules

The root `AGENTS.md` is canonical. `docs/AGENTS-TEMPLATE.md` is the reusable
project template, and harness-specific files only supplement the canonical
rules. Key rules:

1. **Always update docs alongside code** — no code-only PRs for user-facing changes
2. **Track maintained living docs** — use the Doc Freshness registry; optional
   source headers are a reviewer aid, not the system of record
3. **JSDoc is documentation** — route handlers and services must have JSDoc
4. **Examples must work** — if you change an API, update the examples
5. **CHANGELOG is mandatory** — every release gets an entry

## Credit

This approach is inspired by [Monika Voutov's BoardKit Orchestrator](https://github.com/BoardKit/orchestrator), which emphasizes that documentation quality directly impacts AI agent reliability. Credit: @mvoutov
