# SOP: Shared Resources Registry

Keep prompts, skills, and guidelines in sync across repos and agents.

---

## Why Shared Resources?

> "Update once, propagate everywhere." — BoardKit Orchestrator

Without a shared registry:

- Prompts drift between repos
- Agents in different projects behave inconsistently
- SOPs get outdated and forgotten
- New team members copy/paste stale templates

With a shared registry:

- Single source of truth for agent behavior
- Consistent task workflows across all projects
- Easy onboarding (point to the registry)
- Version-controlled evolution

---

## Directory Structure

### Single Repo (Simple)

```
my-project/
├── prompt-registry/           # Workflow prompts
│   ├── sprint-planning.md
│   ├── code-review.md
│   └── ...
├── AGENTS.md                  # Agent personality/rules
├── CLAUDE.md                  # Model-specific notes
└── docs/
    └── BEST-PRACTICES.md      # Team patterns
```

### Multi-Repo (Shared Assets)

```
workspace/
├── shared/                    # Shared across all repos
│   ├── prompt-registry/       # Universal prompts
│   │   ├── sprint-planning.md
│   │   └── cross-model-review.md
│   ├── skills/                # Agent skills/capabilities
│   │   ├── github.md
│   │   └── research.md
│   └── guidelines/            # Universal rules
│       ├── AGENTS-BASE.md
│       └── SECURITY-RULES.md
│
├── project-a/                 # Project-specific
│   ├── AGENTS.md              # Extends shared/guidelines/AGENTS-BASE.md
│   ├── prompt-registry/       # Project-specific prompts
│   │   └── deploy-checklist.md
│   └── ...
│
└── project-b/
    ├── AGENTS.md
    └── ...
```

---

## Mounting Strategies

### Strategy 1: Copy + Customize (Recommended for MVP)

Copy shared resources into each repo, customize as needed:

```bash
# Initial setup
cp -r ../shared/prompt-registry ./prompt-registry
cp ../shared/guidelines/AGENTS-BASE.md ./AGENTS.md

# Periodically sync
diff -u ../shared/prompt-registry ./prompt-registry
# Review changes, merge manually
```

**Pros:** Simple, no tooling required, full control per repo
**Cons:** Manual sync, potential drift

### Strategy 2: Symlinks

Link shared resources into each repo:

```bash
# From project directory
ln -s ../shared/prompt-registry ./prompt-registry-shared
ln -s ../shared/guidelines/AGENTS-BASE.md ./AGENTS-SHARED.md
```

**Pros:** Always in sync, no manual updates
**Cons:** Doesn't work on Windows, requires absolute paths for some tools

### Strategy 3: Git Submodules

Maintain shared resources in a separate repo:

```bash
# Add submodule
git submodule add https://github.com/org/shared-resources.git shared

# Update
git submodule update --remote
```

**Pros:** Versioned, works across orgs
**Cons:** Git submodule complexity

### Strategy 4: NPM/pnpm Package (Future)

Publish shared resources as a package:

```json
{
  "dependencies": {
    "@org/agent-resources": "^1.0.0"
  }
}
```

**Pros:** Semantic versioning, automatic updates
**Cons:** Requires package infrastructure

---

## What to Share

### Always Share

- Cross-model review prompt (consistency is critical)
- Security review checklist
- Definition of Done template
- Sprint planning prompt

### Share Carefully

- Agent personality (AGENTS.md) — may need project-specific tweaks
- API endpoint references — URLs differ per environment
- Notification channels — project-specific

### Don't Share

- Secrets or API keys (use env vars)
- Project-specific business logic
- Team member names/contacts

---

## Skill Capability Declarations

Shared resources with `type: skill` should declare the capabilities they need.
Veritas compares declared capabilities with observed static behavior and shows
the result in Settings -> Shared Resources -> Skill Capability Profiles.

Preferred frontmatter:

```markdown
---
capabilities:
  - filesystem.read
  - network.egress
---
```

Markdown section alternative:

```markdown
## Declared Capabilities

- `filesystem.read`
- `browser.session`
```

Canonical ids:

| Capability          | Use when the skill needs to...               |
| ------------------- | -------------------------------------------- |
| `filesystem.read`   | Read local files or repository content       |
| `filesystem.write`  | Create, edit, move, or delete files          |
| `shell.execute`     | Run shell commands, package scripts, or CLIs |
| `network.egress`    | Call remote APIs, webhooks, or downloads     |
| `credential.access` | Read env vars, tokens, secrets, or keychains |
| `external.message`  | Send chat, email, comments, issues, or PRs   |
| `memory.write`      | Write durable agent memory                   |
| `task.mutate`       | Create or change tasks, issues, or PRs       |
| `schedule.persist`  | Create recurring jobs or background watchers |
| `browser.session`   | Use browser automation or authenticated tabs |
| `mcp.tool`          | Invoke MCP servers, plugins, or connectors   |

Rules:

- Avoid `*` or `all`; wildcard declarations are treated as review findings.
- Keep declarations narrower than the agent role. The skill declares what it
  needs, not what the operator could technically grant.
- Run the skill security scanner before installing or updating local skills that
  include scripts, assets, package manifests, broad triggers, network behavior,
  credential handling, or persistence hooks. Use
  `POST /api/skills/security/scan` or the Maintenance action
  `POST /api/maintenance/skill-security/scan`.
- Review Settings -> Shared Resources -> Skill Risk Dashboard before enabling
  a shared skill. The dashboard joins declared capabilities, observed behavior,
  persisted scan reports, exceptions, and remediation tasks into one install
  decision.
- If the profile reports observed behavior that exceeds declarations, create a
  remediation task from the Shared Resources panel and either narrow the skill or
  add a reviewer-approved declaration.
- Treat `block` install decisions as hard stops for remote and cloud workflows
  unless there is a named owner, clear reason, and future-dated exception.
- Evidence snippets are redacted, but skill authors should still avoid embedding
  example secrets or real customer data in shared skill text.

Scanner reports are stored as JSON and Markdown under
`.veritas-kanban/skill-security-scans/` unless `persist` is `false`. The scanner
checks the local `SKILL.md`, referenced `scripts/` and `assets/`, package
manifests, declared-vs-observed capability mismatches, prompt-injection markers,
credential access, exfiltration, unsafe execution, persistence, memory poisoning,
overbroad triggers, and unpinned or non-registry dependencies where detectable.
Fixture contracts live in
`server/src/__fixtures__/skill-security/` and cover malicious plus benign cases.

---

## Referencing Shared Resources

### In Task Descriptions

```markdown
## Instructions

Follow the standard code review process.
See prompt: `prompt-registry/cross-model-review.md`
```

### In Agent Prompts

```
You are working on project-a. Use the shared guidelines at `shared/guidelines/AGENTS-BASE.md`
combined with project-specific rules at `AGENTS.md`.
```

### In AGENTS.md

```markdown
# AGENTS.md

This project extends the base guidelines at `../shared/guidelines/AGENTS-BASE.md`.

## Project-Specific Rules

- Use project-a-specific API at http://localhost:4000
- Deploy requires approval from @project-lead
```

---

## Versioning & Updates

### Semantic Versioning for Shared Resources

```
shared/
├── VERSION                    # 1.2.0
├── CHANGELOG.md               # What changed
└── prompt-registry/
    └── ...
```

### Update Protocol

1. **Propose** — Create PR/issue in shared resources repo
2. **Review** — Team reviews impact across all projects
3. **Test** — Verify in one project first
4. **Propagate** — Update all repos (manual or via sync script)
5. **Announce** — Notify team of changes

---

## Migration Checklist

Moving from ad-hoc prompts to shared registry:

- [ ] Audit existing prompts across all repos
- [ ] Identify duplicates and conflicts
- [ ] Create canonical versions in shared location
- [ ] Update all repos to reference shared versions
- [ ] Remove duplicate copies
- [ ] Document the new structure in each repo's README
- [ ] Train team on update protocol

---

## Credit

Shared resources pattern inspired by [BoardKit Orchestrator](https://github.com/BoardKit/orchestrator) by Monika Voutov.
