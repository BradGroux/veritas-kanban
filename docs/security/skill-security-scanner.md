# Skill Security Scanner

The v5 skill security scanner is a static first-pass review for local skills. It
accepts a skill directory or a single `SKILL.md`, returns structured JSON, and
persists JSON plus Markdown reports under
`.veritas-kanban/skill-security-scans/` unless `persist` is `false`.

## When to Run It

Run the scanner before installing or updating a skill that contains scripts,
assets, package manifests, broad trigger language, network access, credential
handling, persistence hooks, durable memory behavior, or tool/runtime
instructions.

```bash
curl -X POST http://localhost:3001/api/skills/security/scan \
  -H 'Content-Type: application/json' \
  -d '{"path":"/absolute/path/to/skill","persist":true}'
```

Maintenance callers can use the equivalent admin-only action:

```http
POST /api/maintenance/skill-security/scan
```

## Risk Inventory and Workflow Gates

Persisted scans feed the shared skill risk inventory:

```http
GET /api/skills/security/inventory
```

The inventory is shown in Settings -> Shared Resources -> Skill Risk Dashboard.
It combines shared skill metadata, declared-vs-observed capability mismatches,
latest scan summaries, remediation task links, and temporary exceptions.

Install decisions are intentionally conservative:

- `allow`: no blocking risk or an active reviewed exception.
- `warn`: medium or caution risk that needs acknowledgement.
- `block`: high, critical, or `do-not-install` risk.

Workflow authoring dry-runs include a `skillAudit` summary for `skill:<id>` and
`skill/<id>` references found in agents, tools, steps, variables, inputs, and
descriptions. Local workflows warn on unscanned skills; remote and cloud
workflows block unscanned, missing, or blocked skills unless an active exception
exists.

## Detector Scope

The scanner currently detects:

- Prompt injection through instruction overrides, hidden comments, and
  zero-width text.
- Exfiltration through remote egress, remote script fetch/execute, and
  file-to-network combinations.
- Credential harvesting through env, token, API key, keychain, password, and
  authorization references.
- Unsafe execution through shell, subprocess, eval, and dynamic code patterns.
- Persistence through cron, launch agents, daemons, watchers, background jobs,
  self-modification, and durable memory writes.
- Memory poisoning and overbroad trigger rules.
- Declared capability mismatches by reusing the skill capability profile model.
- Unpinned or non-registry dependencies where statically detectable from
  package manifests.

This is not a full sandbox or dependency vulnerability audit. Treat `safe` as
"no configured static pattern fired", not as proof that a skill is harmless.

## Artifacts

Every persisted scan writes:

- `<scan-id>.json`: structured report with files, findings, severity, risk
  score, recommendation, capability profile, and redacted evidence.
- `<scan-id>.md`: human-readable review report for PRs or maintenance notes.
- Audit event `skill.security.scan.completed` with scan id, severity, risk
  score, recommendation, and finding count.

Evidence snippets are redacted with the same string redactor used by server
logs. Fixtures intentionally use placeholder secret-like strings and assert that
raw placeholder values do not appear in reports.

## Fixture Contract

Fixtures live in `server/src/__fixtures__/skill-security/`.

Each fixture includes:

- `SKILL.md`
- optional `scripts/`, `assets/`, or package manifests
- `expected.json` with expected findings, absent findings, max severity,
  recommendation, and optional redaction assertions

Run the fixture gate:

```bash
pnpm --filter @veritas-kanban/server test -- skill-security-service.test.ts
```
