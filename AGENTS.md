# AGENTS.md — Canonical Agent Instructions for Veritas Kanban

> **Canonical source.** All coding harnesses — Codex, OpenClaw, Hermes, Claude, and others —
> read this file first. Harness-specific supplements (e.g. `CLAUDE.md`) extend, never duplicate
> or contradict, these rules.
>
> **Version:** 5.2.5
> **Freshness policy:** update within two working days of any toolchain or architecture change.
> Stale fields (package manager, Node version, provider list, test commands) are caught by
> `pnpm check:pnpm-settings` and the smoke-test CI job.

---

## Runtime requirements

| Tool    | Required version | How to verify    |
| ------- | ---------------- | ---------------- |
| Node.js | ≥ 22.22.1        | `node --version` |
| pnpm    | ≥ 11.0.0         | `pnpm --version` |
| Git     | ≥ 2.38           | `git --version`  |

The `packageManager` field in `package.json` is pinned to `pnpm@11.1.1`. Do not install with npm
or yarn. Do not up-rev the pin without updating this file.

---

## Repository layout

```
veritas-kanban/
├── server/          Express + TypeScript API, agent orchestration, storage
├── web/             React + Vite SPA
├── cli/             Commander.js CLI (mirrors API endpoints)
├── shared/          Shared TypeScript types and utilities
├── mcp/             MCP server
├── desktop/         Electron desktop wrapper
├── docs/            Operator and developer documentation
├── prompt-registry/ Prompt templates and cross-model review SOPs
└── .veritas-kanban/ Runtime data: agent-registry, logs, telemetry
```

Workspaces are declared in `pnpm-workspace.yaml`.

---

## Essential commands

```bash
# Install
pnpm install

# Build (all workspaces in dependency order)
pnpm build

# Dev server (server + web, hot-reload)
pnpm dev

# Tests
pnpm test                       # Vitest across server, web, mcp, cli
pnpm test:unit                  # Per-workspace tests sequentially
pnpm test:e2e                   # Playwright end-to-end

# Type check (builds shared first)
pnpm typecheck

# Lint / fix
pnpm lint
pnpm lint:fix

# Smoke checks
pnpm check:pnpm-settings        # Validates package manager fields match this file
pnpm smoke:cli-mcp              # CLI ↔ MCP compatibility smoke test
```

Do not run `npm install`, `yarn`, or `bun install`. If lockfile conflicts arise, resolve with
`pnpm install` and commit the updated `pnpm-lock.yaml` without reformatting it.

---

## Architecture rules

### Server (Express + TypeScript)

- All routes go through centralized middleware in `server/src/middleware/`.
- Auth: JWT + API keys. Dev bypass: `VERITAS_AUTH_LOCALHOST_BYPASS=true`.
- Storage: always go through `storage/interfaces.ts`. Never import `fs` directly in service files.
- Error classes: `UnauthorizedError`, `ForbiddenError`, `BadRequestError`, `InternalError`.
- Pagination: `sendPaginated(res, items, { page, limit, total })`.
- Path traversal: always call `validatePathSegment()` on any user-supplied path component,
  then `ensureWithinBase(base, resolved)` before file I/O.
- SQLite journal conversion runs from the bootstrap before `server.ts` imports routes. Normal
  startup eagerly creates many independent SQLite handles, so a live API handler cannot prove
  exclusive database ownership.
- Governed SQLite `DELETE` or expert-override mode requires the signed external policy and the
  reference-counted process/host ownership lock. Do not reuse the short-lived generic `FileLock`
  for authoritative database ownership.

### Web (React + Vite)

- State: Zustand stores. No prop drilling past 2 levels.
- Realtime: `useRealtimeUpdates` WebSocket hooks. Do not add polling when a hook exists.
- Styling: Tailwind CSS with component-scoped overrides.
- Frontend interfaces must exactly match server response shapes. Server is the source of truth.

### CLI (Commander.js)

- Every command mirrors an API endpoint.
- `--json` flag for machine-readable output.
- Colored output via `chalk`.

### Shared types

- All cross-package types live in `shared/src/types/`.
- `AgentProvider` union is the single definition consumed by both server and web.
  **Currently supported providers:**
  `openclaw` | `codex-cli` | `codex-sdk` | `codex-cloud` | `hermes-cli` |
  `ollama-local` | `ollama-cloud` | `lm-studio-local` | `custom`
- Executable task adapters are currently `openclaw`, `codex-cli`, `codex-sdk`,
  and `hermes-cli`. Explicitly configured providers outside that set must fail
  closed; never route them through an implicit OpenClaw fallback.
- Probe and persist `provider-runtime-manifest/v1` before mutating attempt state.
  New runtime controls must use the persisted evidence instead of provider-name
  checks, and provider version/build changes must invalidate cached conformance.
  Increment `PROVIDER_RUNTIME_PROBE_REVISION` whenever probe semantics or the
  built-in adapter capability evidence changes.
- Normalize every configured harness through `harness-support-profile/v1`.
  Settings, API diagnostics, `vk doctor`, dispatch, and telemetry must use the
  same support tier and redacted readiness evidence. Only known legacy records
  whose built-in type and command both identify `codex` or `hermes` may infer a
  provider during migration; provider-less or profile/adapter-mismatched records
  fail closed before an attempt is created.

---

## Agent provider notes

### OpenClaw (v2026.6.11)

- Task dispatch uses the gateway `/tools/invoke` endpoint with `sessions_spawn`.
- **Required gateway policy:** `sessions_spawn` and `sessions_send` must be explicitly allowed
  on the operator-level gateway; they are blocked by default on fresh OpenClaw installs.
- Set `OPENCLAW_GATEWAY_URL` (default `http://127.0.0.1:18789`) and optionally
  `OPENCLAW_GATEWAY_TOKEN`.
- A pre-flight check is run before a task is marked active; policy denial returns an actionable
  configuration error.
- See `docs/AGENT-PROVIDERS.md` § OpenClaw for full setup instructions.

### Hermes Agent (v2026.7.7.2)

- Dispatch uses the one-shot scripted interface: `hermes -z <prompt>`.
- Hermes is spawned in the task worktree without a shell; stdout captures the final response,
  stderr captures diagnostics.
- Project instructions are loaded automatically from `AGENTS.md` in the worktree root.
- Session resume is not yet implemented; `--resume`/`--continue` are reserved for a future
  provider iteration.
- Provider ID: `hermes-cli`. Auth probe: `hermes --version`.
- Set `HERMES_API_KEY` or the appropriate model-provider key in the operator environment.
- See `docs/AGENT-PROVIDERS.md` § Hermes for full setup instructions.

### Codex (OpenAI)

- `codex-cli`: `codex exec --sandbox workspace-write --json`
- `codex-sdk`: programmatic SDK, requires `@openai/codex-sdk`
- Auth: `codex login status` / `OPENAI_API_KEY`

---

## Security boundaries

- **No secrets in code.** Use environment variables or brokered credentials.
- **Input validation.** All user input is validated with Zod schemas before processing.
- **Path traversal.** `validatePathSegment()` + `ensureWithinBase()` on every user-supplied path.
- **Env passthrough.** Agents receive only the keys in the configured safe allowlist; see
  `server/src/utils/codex-env.ts` and `server/src/utils/hermes-env.ts`.
- **Launch arguments.** Never put credential values in provider commands or arguments; use an
  allowlisted environment key or run-scoped brokered credential reference.
- **Log redaction.** Trace logs and telemetry run through `TRACE_SECRET_PATTERNS` before storage.
- **No credentials in PR descriptions, test fixtures, or log snippets.**

---

## Testing expectations

- Framework: **Vitest** (server, cli, mcp), **React Testing Library** (web).
- Test files: `*.test.ts` co-located in `src/__tests__/` or alongside source.
- Aim for >80% coverage on critical paths (agent dispatch, auth, storage adapters).
- Use `vi.mock()`/`vi.fn()` to isolate external processes and HTTP calls; no live credentials
  in unit tests.
- Credential-gated smoke tests document the tested provider version in a `@smoke` describe block.
- Match actual runtime schema in test fixtures — wrong field names (`status: "success"` vs
  `success: true`) are a common source of false-passing tests.

---

## Multi-agent runtime

- Agent registry: `.veritas-kanban/agent-registry.json` (file-based).
- Agent names: use ALL CAPS for acronyms (VERITAS, TARS, CASE, K-2SO, R2-D2, MAX).
- Heartbeat timeout: 5 min (configurable). Stale-check interval: 1 min.
- Activity data source of truth: `status-history` files, not `activity.json`.
- Dashboard optimistic updates: use `onMutate` in Zustand mutations.

---

## Conventions

| Artifact    | Style                                                            |
| ----------- | ---------------------------------------------------------------- |
| TS files    | `kebab-case.ts`                                                  |
| Components  | `PascalCase.tsx`                                                 |
| Variables   | `camelCase`                                                      |
| Constants   | `UPPER_SNAKE_CASE`                                               |
| Git commits | Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)        |
| Branches    | `feat/description-issue-number` / `fix/description-issue-number` |

---

## Code quality gates

1. **Cross-model review** required for non-trivial code changes. If Claude writes it, GPT
   reviews; if GPT writes it, Claude reviews. See `prompt-registry/cross-model-review.md`.
2. **No direct `fs` imports** in service files — use the storage abstraction layer.
3. **All provider schemas validated** — do not guess flag names; verify against versioned docs
   or provider `--help` output.
4. **pnpm-lock.yaml** is generated by pnpm; do not reformat or hand-edit it.

---

## File locations quick-reference

| What             | Where                                 |
| ---------------- | ------------------------------------- |
| API routes       | `server/src/routes/`                  |
| Services         | `server/src/services/`                |
| Zod schemas      | `server/src/schemas/`                 |
| Storage          | `server/src/storage/`                 |
| Server utilities | `server/src/utils/`                   |
| React components | `web/src/components/`                 |
| Zustand stores   | `web/src/stores/`                     |
| CLI commands     | `cli/src/commands/`                   |
| Shared types     | `shared/src/`                         |
| MCP server       | `mcp/src/`                            |
| Prompt registry  | `prompt-registry/`                    |
| SOPs             | `docs/SOP-*.md`                       |
| Agent registry   | `.veritas-kanban/agent-registry.json` |
| Agent run logs   | `.veritas-kanban/logs/`               |
| Telemetry events | `.veritas-kanban/telemetry/`          |

---

## Harness-specific supplements

| Harness     | File        | Purpose                                           |
| ----------- | ----------- | ------------------------------------------------- |
| Claude      | `CLAUDE.md` | Claude-specific lessons, cross-model review notes |
| Codex / GPT | `AGENTS.md` | This file (canonical)                             |
| Hermes      | `AGENTS.md` | This file (Hermes reads AGENTS.md first)          |
| OpenClaw    | `AGENTS.md` | This file                                         |
