# AGENTS.md — Canonical Agent Instructions for Veritas Kanban

> **Canonical source.** Contributors and harnesses with repository-instruction discovery read
> this file first. Every Veritas-managed run also receives an immutable task envelope; do not
> assume a provider that disables custom instructions reads repository files implicitly.
> Harness-specific supplements (for example `CLAUDE.md`) extend, never duplicate or contradict,
> these rules. See `docs/AGENTS-TEMPLATE.md` for the managed-run and external-agent protocols.
>
> **Version:** 6.0.2
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
pnpm check:delivery-cadence     # Prevents verification and review policy drift
pnpm test:ci-scope              # Validates path-aware CI test selection
pnpm smoke:cli-mcp              # CLI ↔ MCP compatibility smoke test
pnpm test:buzz:compatibility    # Credential-free composed Buzz release gate
```

Do not run `npm install`, `yarn`, or `bun install`. If lockfile conflicts arise, resolve with
`pnpm install` and commit the updated `pnpm-lock.yaml` without reformatting it.

---

## GitHub workflow

- Use the authenticated GitHub CLI (`gh`) as the default interface for GitHub issues, pull
  requests, releases, workflow runs, and API calls.
- Use `git` for local repository operations and `gh` for GitHub-hosted state.
- Do not loop through alternate connectors or permission paths while `gh` is authenticated and
  can perform the operation.
- Fall back only when `gh` is unavailable or cannot support the required operation. Report the
  exact blocker before changing paths.
- Source every published GitHub release body from `docs/releases/vX.Y.Z.md` and pass that file
  to `gh release create` or `gh release edit` with `--notes-file`.
- Never hand-author or repair a release body with `--notes`, the GitHub editor, or a raw API
  body. Edit the reviewed source file first, validate it, and publish that exact file.
- Keep each prose paragraph and list item on one logical Markdown source line. Separate blocks
  with blank lines. Do not hard-wrap release prose or add carriage returns, trailing-space hard
  breaks, literal escaped newlines, HTML `<br>` tags, or blockquotes.
- Prefer compact, natural paragraphs over bullet-per-sentence formatting. Use lists only for
  genuinely parallel items. Keep rendered prose blocks concise so they do not become walls of
  text on GitHub's release index.
- Run `pnpm validate:release -- --version X.Y.Z`; the post-publication `--github` form also
  requires the published GitHub body to match the reviewed file exactly.
- After publication, inspect both the releases index and tag page. Raw Markdown validation does
  not replace a rendered-format check.

---

## Sustainable execution cadence

- Keep each issue and pull request to one independently shippable behavior. When implementation
  reveals a separable UI surface, secondary integration, refactor, or hardening follow-up, open
  a linked issue instead of expanding the active pull request.
- Re-scope before continuing when an issue no longer fits one coherent review, an unexpected
  subsystem becomes necessary, or verification work is larger than the behavior being changed.
- At the 45-minute delivery checkpoint, if the issue is not pull-request ready, stop adding scope
  and report the concrete cause. Split independent remaining work into linked issues, or continue
  only when the next step is required to preserve correctness of the current behavior.
- During implementation, run the narrowest useful loop: type-check touched packages, lint changed
  files, and run focused tests for changed behavior and high-risk edges.
- Run focused Vitest slices with
  `pnpm --filter <package> exec vitest run <exact-test-files>`. Do not use
  `pnpm --filter <package> test -- <test-files>` or
  `pnpm --filter <package> test -- --run <test-files>`; package wrappers can ignore that file
  boundary and expand into the entire package suite.
- Do not rerun an unchanged passing gate after documentation, comments, or formatting-only edits.
  Rerun only the checks affected by the later change.
- Use the complete workspace suite once at an explicit integration, critical-security, or release
  milestone. Pull-request label `ci:full`, scheduled CI, and manual full dispatch are the
  authoritative broad gates.
- Trust `scripts/select-ci-test-scope.mjs` and the `Select Test Scope` job to choose the required
  CI tier. Do not add broader local gates merely to duplicate CI.
- Do not wait for optional desktop packaging, artifact previews, or release workflows when the
  change does not touch their product boundary. They are evidence only when declared relevant.
- Add enough regression coverage to prove the behavior and its meaningful failure modes. Test
  count is not a quality target.

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
  `openclaw` | `codex-cli` | `codex-sdk` | `codex-app-server` | `codex-cloud` |
  `claude-code` | `acp-stdio` | `hermes-cli` | `ollama-local` | `ollama-cloud` |
  `lm-studio-local` | `custom`
- Executable task adapters are currently `openclaw`, `codex-cli`, `codex-sdk`,
  `codex-app-server`, `claude-code`, `acp-stdio`, and `hermes-cli`. Explicitly
  configured providers outside that set must fail closed; never route them
  through an implicit OpenClaw fallback.
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
- Route direct, profile, conversation, provider-handoff, child-agent, retry,
  fallback, scheduled, watcher, and workflow launches through the shared
  admission controller. A `queued` response means Veritas durably accepted
  ownership; harnesses must not submit a duplicate or create a hidden
  provider-side queue. Provider adapters require
  `provider-admission-evidence/v1` before dispatch.
- Phase authority uses the versioned contracts in
  `shared/src/types/phase-capability.types.ts`. Compile parent, phase, agent
  profile, sandbox, tool-catalog, and launch-policy authority only through
  `phase-capability-service.ts`; never union scopes or infer missing
  dimensions. The plan artifact exception is one harness-owned exact path and
  never implies general filesystem write authority. Active phase changes go
  only through `phase-transition-service.ts` with exact attempt, sequence,
  evidence-digest, and launch-manifest compare-and-set guards. Authority
  expansion requires an exact-action approval; an emergency override requires
  `admin:manage`, expires within 24 hours, and is durably reverted. Every task
  launch, workflow step, retry or fallback, resume, follow-up, fork, compaction
  control, and provider handoff must bind the effective phase before attempt
  mutation. Descendants inherit and intersect the exact parent launch or
  transition evidence and cannot widen it. Explicit phases fail closed when any
  required dimension is not enforceable. Run tool catalogs are filtered by the
  launch phase, mediated calls re-check the active phase, and approvals bind the
  exact phase evidence and transition sequence. ACP stdio is the only current
  adapter with enforceable command and external-action mediation; other
  adapters return typed blockers for explicit phases.
- Credential-bound tool servers persist only exact definition/scope digests and
  safe target names in `run-tool-catalog/v1`. Discovery strips their source
  environment/header values, native provider injection omits them, and
  mediated invocation issues exact-action leases using the server-owned launch
  manifest digest. Credential-bound sessions are one-shot and raw values may
  exist only inside the controlled downstream dispatch callback.
- Providers access credential-bound tools only through the system-owned
  `veritas-run` MCP bridge and an opaque in-memory run handle. Codex CLI/SDK,
  Codex app-server, Claude Code, and ACP stdio inject this shared contract;
  Hermes and OpenClaw fail closed until their certified transports can enforce
  it.
- Classify launch credentials through `run-launch-credential-plan/v1`.
  Provider boot authentication, task integration definition IDs, and explicit
  high-risk environment passthrough are separate classes. Task integration
  credentials fail closed until an accepted tool or egress boundary proves
  brokered, non-bypassable delivery.
- Atomically persist `admission-reservation/v1` before direct task attempts,
  workflow roots, executable workflow steps, pending-run state, or provider
  state. Workflow roots use the explicit `workflow-control` admission provider;
  provider-backed steps bind the resolved provider, selected host, root
  reservation, run, and step before attempt mutation. Capacity claims use the
  storage repository transaction or file lock, never process-local counters.
  Keep the invariant one-active-run-per-task policy and configured global,
  workspace, root-task, provider, and host ceilings aligned across dispatch,
  REST, and `vk`.
  Persist only a stable digest of caller-supplied idempotency values.
  Completion, interruption, cancellation, and start failure release once;
  restart recovery may reclaim only after the durable run supervisor verifies
  the original live process or session.
- Bind every executable reservation to `execution-tree-identity/v1`. Descendants
  retain the root objective and exact parent edge across resume, follow-up,
  fork, retry, fallback, provider handoff, workflow step, and child-agent
  launches. Claim capacity and aggregate budget in the same repository lock or
  transaction. Usage events must be idempotent and attributable to one node;
  never copy cumulative parent or descendant totals into another contributor.
  Release unused reservation while retaining committed usage.
- Persist `run-supervisor/v1` before provider dispatch. Restart recovery must
  validate the exact runtime, task-envelope, launch-manifest, worktree, host,
  lease, and process/session identity; replay only after the durable event
  cursor; and record a typed recovery action instead of starting duplicate work
  or signaling an unverified process.
- Resolve selected MCP servers through `tool-server-definition/v1` and persist
  an immutable `run-tool-catalog/v1` before provider dispatch. Required
  discovery failures block launch; optional failures remain visible and
  audited.
- Native provider configuration may expose only tools with an `allow`
  decision. Approval-required tools must use the Veritas-mediated
  `call_run_tool` path so the exact action hash is approved before dispatch.
- Tool-server environment values and credential values are never persisted.
  Credential-bound tool definitions remain fail-closed until the provider
  launch credential broker is active.

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
- `codex-app-server`: pinned to `codex-cli 0.145.0`; supervised JSON-RPC v2 over
  strict stdio for one task-bound thread and turn.
- App-server launch arguments are system-owned. Inherited MCP servers, hooks,
  plugins, apps, browser/computer tools, and remote control remain disabled.
  Selected run-scoped MCP servers are injected only through the immutable
  catalog's thread configuration.
- App-server consumes only the checked-in v0.145.0 schemas and exposes
  `initialize`, thread start/resume/fork/compact/archive, and turn
  start/steer/interrupt. `thread/shellCommand` is never reachable.
- `conversation-lifecycle/v1` persists opaque thread, turn, item, parent, and
  fork identities. Resume and fork validate the source launch manifest,
  provider/model/policy, base revision, and worktree compatibility before a new
  attempt is created.
- App-server command, file, permission, tool-question, and elicitation requests
  use `run-approval/v1`. Decisions must preserve the persisted revision and
  exact action hash; interruption and cancellation invalidate pending requests.
- Auth: `codex login status` / `OPENAI_API_KEY`

### Claude Code (v2.1.218)

- Provider ID: `claude-code`. Default command: `claude`.
- Veritas launches `claude --bare --print --output-format stream-json` with
  static sandbox-derived permissions and no shell.
- Bare mode requires explicit environment authentication. OAuth/keychain state
  reported by `claude auth status` does not prove bare-mode readiness.
- The terminal `result` record is authoritative. Veritas drains stdout after
  process close, persists `session_id`, and maps partial, hook, tool, subagent,
  usage, cost, and result records into `run-event/v1`.
- Resume uses the exact persisted session through system-owned `--resume`.
  Native history fork adds `--fork-session`; caller-supplied lifecycle flags
  remain prohibited. Run-scoped MCP uses a system-owned strict config and
  exposes only catalog tools with an `allow` decision.
- The shared approval broker is available, but Claude stays on static
  `dontAsk` permissions until its adapter exposes a pinned interactive
  request/response contract.

### Agent Client Protocol (ACP v1)

- Provider ID: `acp-stdio`. Configure the exact ACP agent command and arguments.
- Veritas launches the agent without a shell in the task worktree and negotiates
  stable ACP protocol version 1 before attempt mutation.
- Capability evidence comes from `initialize`; resume/load, fork, and close fail
  closed when the runtime does not advertise them.
- `session/update` records enter the causal run journal.
  `session/request_permission` uses the durable approval broker.
- Only immutable all-allow MCP server catalogs can be passed natively because
  ACP v1 has no per-tool allowlist. Profiles may explicitly require the
  system-owned `veritas-run` bridge for mediated catalogs; otherwise partial
  native catalogs fail closed.
- The built-in `buzz-agent` profile remains provider `acp-stdio`, pins Buzz
  `v0.4.24` at commit `710ed9fff57878a1d69f809b80a6ee0416c53fc4`, and rejects
  `buzz-acp`, version drift, session loading, and network MCP claims. Selected
  run tools are delivered only through the opaque, attempt-bound
  `veritas-run` bridge.
- The built-in `copilot` profile remains provider `acp-stdio`, pins Copilot CLI
  `v1.0.74`, owns the stdio safety argv, rejects broad allow/remote/TCP/config
  injection, and records public-preview plus incomplete-source limitations.
- The built-in `grok-build` profile remains provider `acp-stdio`, pins Grok
  Build `v0.2.111` build `94172f2aa4e5`, launches `grok agent --no-leader
stdio`, and rejects approval bypass, reauthentication, leader, plugin,
  endpoint, prompt, and resume argument injection.
- Harness certification uses `harness-conformance-suite/v1`; run the committed
  mock lane with `pnpm --filter @veritas-kanban/server exec tsx
src/scripts/run-harness-conformance.ts -- --suite <suite.json>
--observations <observations.json>`. Credential-gated lanes require explicit
  opt-in and never commit raw provider output or secrets.
- Cross-harness compatibility is published as
  `harness-compatibility-matrix/v1`. API, `vk doctor`, Settings, telemetry, and
  `docs/HARNESS-COMPATIBILITY.md` must use the reviewed profile capability
  digest, fixture revision, invalidation policy, and source caveats rather than
  defining provider-specific tiers.
- Runtime extensions use the in-process `runtime-hook/v1` bus. Only documented
  pre-events may deny, post-events remain passive, and arbitrary executable or
  HTTP handlers stay unsupported until their filesystem and egress boundaries
  are enforceable. See `docs/architecture/RUNTIME-HOOK-V1.md`.
- `vk acp serve --stdio` exposes one Veritas-managed task as an ACP v1 server
  view for editors and other ACP clients. Bind with `--task` or require
  `_meta["veritas/taskId"]` on `session/new`; client-owned MCP catalogs fail
  closed.
- ACP client disconnect never stops the durable Veritas run. Reconnect with
  `session/load` and `_meta["veritas/afterSequence"]`; cancellation uses the
  conversation interrupt path, not task termination.
- See `docs/AGENT-PROVIDERS.md` § ACP stdio agent provider.

---

## Security boundaries

- **No secrets in code.** Use environment variables or brokered credentials.
- **Input validation.** All user input is validated with Zod schemas before processing.
- **Path traversal.** `validatePathSegment()` + `ensureWithinBase()` on every user-supplied path.
- **Env passthrough.** Agents receive only the keys in the configured safe allowlist; see
  `server/src/utils/codex-env.ts`, `server/src/utils/hermes-env.ts`, and
  `server/src/services/claude-code-adapter.ts` plus
  `server/src/services/acp-stdio-adapter.ts`.
- **Launch arguments.** Never put credential values in provider commands or arguments; use an
  allowlisted environment key or run-scoped brokered credential reference.
- **Workspace execution trust.** Scan repository-controlled instructions,
  hooks, MCP servers, workflows, extensions, and provider configuration before
  launch. Bind the exact inventory and decision to the run launch manifest,
  then rescan before provider creation. Project policy may narrow trust only.
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

| Artifact    | Style                                                     |
| ----------- | --------------------------------------------------------- |
| TS files    | `kebab-case.ts`                                           |
| Components  | `PascalCase.tsx`                                          |
| Variables   | `camelCase`                                               |
| Constants   | `UPPER_SNAKE_CASE`                                        |
| Git commits | Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) |
| Branches    | `feat/description-issue-number`, `fix/...`, or `docs/...` |

---

## Code quality gates

1. **No direct `fs` imports** in service files — use the storage abstraction layer.
2. **All provider schemas validated** — do not guess flag names; verify against versioned docs
   or provider `--help` output.
3. **pnpm-lock.yaml** is generated by pnpm; do not reformat or hand-edit it.

Independent or cross-model review is optional. Run it only when the task,
configured governance policy, issue owner, or release owner explicitly requires
it.

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

## Harness instruction sources

| Harness            | Instruction source                                                     | Purpose                                             |
| ------------------ | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Buzz Agent         | Veritas task envelope; repository files only if the runtime reads them | ACP task, worktree, tool, and completion contract   |
| Grok Build         | Veritas task envelope                                                  | ACP task, worktree, tool, and completion contract   |
| GitHub Copilot CLI | Veritas task envelope                                                  | ACP task, worktree, tool, and completion contract   |
| Codex / GPT        | `AGENTS.md` plus Veritas task envelope                                 | Canonical repository rules and managed-run contract |
| Claude Code        | `AGENTS.md`, `CLAUDE.md`, and Veritas task envelope                    | Canonical rules plus Claude-specific lessons        |
| Hermes             | `AGENTS.md` plus Veritas task envelope                                 | Hermes reads `AGENTS.md` from the worktree          |
| OpenClaw           | `AGENTS.md` plus the gateway task request                              | Canonical rules and callback completion contract    |
