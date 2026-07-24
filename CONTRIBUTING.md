# Contributing to Veritas Kanban

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** 22 or later
- **pnpm** 11+ (package manager)

## Development Setup

1. **Fork the repository** on GitHub

2. **Clone your fork:**

   ```bash
   git clone https://github.com/<your-username>/veritas-kanban.git
   cd veritas-kanban
   ```

3. **Install dependencies:**

   ```bash
   pnpm install
   ```

4. **Set up environment variables:**

   ```bash
   cp server/.env.example server/.env
   ```

   Edit `server/.env` with your local configuration (at minimum, set `VERITAS_ADMIN_KEY`).

5. **Start the development server:**

   ```bash
   pnpm dev
   ```

   The board auto-seeds with example tasks on first run. To re-seed manually: `pnpm seed`.

## Project Structure

Veritas Kanban is a monorepo:

```
veritas-kanban/
├── server/     # Backend API (Express + TypeScript)
├── web/        # Frontend UI (React + Vite + TypeScript)
├── shared/     # Shared types & contracts
├── cli/        # `vk` CLI tool
├── mcp/        # MCP server for AI assistants
├── tasks/      # Task storage (Markdown files, gitignored)
│   ├── active/     # Current tasks (your data, not tracked)
│   ├── archive/    # Archived tasks (not tracked)
│   └── examples/   # Seed tasks for first-run
├── scripts/    # Build and utility scripts
└── docs/       # Documentation
```

> **Note:** Your task data (`tasks/active/`, `tasks/archive/`) is `.gitignore`d and never committed. Only `tasks/examples/` (seed data) is tracked.

## Development Workflow

### Creating a Feature Branch

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes — write code, add tests, update docs.

3. Run type checking, linting, and focused tests before committing:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm --filter @veritas-kanban/server exec vitest run src/path/to/changed.test.ts
   ```

   Use `pnpm test` at integration or release milestones, or when the change
   affects shared foundations broadly enough that focused selection is unsafe.

4. Commit using [conventional commits](#commit-conventions).

5. Push to your fork and open a pull request.

### Branch Merge Protocol

**Critical:** When merging multiple feature branches, merge **one at a time**. Never batch-merge parallel branches.

**Process:**

1. Merge first branch to `main`
2. Build all packages: `pnpm build`
3. Run smoke tests (see [Testing Requirements](#testing-requirements))
4. Only after smoke tests pass, merge the next branch
5. Repeat for each branch

**Why:** Parallel branches often introduce integration issues that are hidden when batch-merging. Sequential merges with testing between each merge catch these immediately.

### One Agent Per File Rule

**Critical:** Only one agent (human or AI) should edit a file at a time. Never assign multiple agents to modify the same file concurrently.

**Why:** When multiple agents edit the same file independently, each change stomps on the others. Even if each change is correct in isolation, they create conflicts and break functionality when combined. This applies to both human and AI contributors.

**Process:**

1. Assign one agent to a file or task
2. That agent completes their work and confirms they're done
3. Only then can another agent touch that file
4. If a task requires changes across multiple files, one agent owns the full task

**This is a hard constraint, not a guideline.** It's the file-level equivalent of sequential branch merges.

### Squad Chat Protocol (Mandatory)

Every agent (human or AI) **must** post to squad chat when starting work, hitting milestones, completing tasks, or finding issues. Squad chat is the glass box — real-time visibility into what's happening.

```bash
# Regular messages (agents post these):
./scripts/squad-post.sh --model claude-sonnet-4.5 AGENT_NAME "Your update" tag1 tag2

# System events (orchestrator posts these):
./scripts/squad-event.sh --model claude-sonnet-4.5 spawned AGENT_NAME "Task Title"
./scripts/squad-event.sh completed AGENT_NAME "Task Title" "2m35s"

# Or curl directly:
curl -s -X POST "http://localhost:3001/api/chat/squad" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"AGENT_NAME","message":"Your update","tags":["tag1"],"model":"claude-sonnet-4.5"}'
```

The `--model` flag is optional but recommended — it shows which AI model is behind each agent in the UI. System events (`spawned`, `completed`, `failed`) render as divider lines in the squad chat panel.

See [SQUAD-CHAT-PROTOCOL.md](docs/SQUAD-CHAT-PROTOCOL.md) for full details.

### Pre-Commit Review Protocol (Mandatory)

Before every commit, run these 4 reviews:

1. **Code Review** — Code quality, anti-patterns, architectural issues, file locking, path validation
2. **Functionality Review** — All endpoints work, CRUD operations, settings save/load
3. **Performance Review** — API response times, bundle size, React optimizations, memory leaks
4. **Security Review** — Auth/authz, injection vectors, secrets exposure, CORS/CSP, rate limiting

All four must pass (10/10) before committing. If ANY review says unsafe:

1. Fix the issue
2. Have the SAME reviewer who found it verify the fix
3. Get human approval
4. Then commit

**Never commit when a review says "unsafe." Never push without human approval.**

These reviews are mandatory, not optional. They catch runtime issues that static analysis and builds miss.

### Pre-Merge Checklist

Before merging any branch, verify:

- [ ] **Type exports:** All new types added to `shared/` are exported in `shared/src/types/index.ts`
- [ ] **Type checks pass:** `pnpm typecheck` succeeds for all workspace packages (shared, server, web, CLI, MCP)
- [ ] **Builds pass:** `pnpm build` succeeds for all packages (shared, server, web, CLI, MCP)
- [ ] **No hardcoded values:** No hardcoded ports, URLs, or timeouts in application code
- [ ] **CSP/CORS configs:** Security policies work in both `NODE_ENV=development` AND `NODE_ENV=production`
- [ ] **Frontend hooks:** All HTTP calls use shared helpers (`apiFetch`) and all WebSocket/URL logic uses `window.location.host` (not hardcoded ports)
- [ ] **Environment variables:** All configurable values use env vars with sensible defaults

### Environment Rules

**Never change these without team agreement:**

- **PORT in `.env`:** Server default is 3001. Changing this breaks CLI/API workflows and bookmarks.
- **CORS_ORIGINS:** Must include the production serving origin (e.g., `http://localhost:3000` when Express serves the built frontend in production mode).
- **CSP `connect-src`:** Must allow WebSocket connections in all modes (dev, production, test). Don't hide WebSocket support behind `isDev` checks.
- **Configurable values:** Use environment variables with sensible defaults. No magic numbers in code.

**Rule of thumb:** If changing a value would break someone else's local setup, it belongs in an environment variable with documentation.

### Testing Requirements

**"Builds clean" is necessary but NOT sufficient.**

Before declaring a branch ready to merge, verify **runtime behavior:**

1. **Health check:** `curl http://localhost:3000/api/health` returns 200
2. **Auth flow:** Log in via the UI, verify token handling works
3. **Task CRUD:** Create, update, move, and delete a task
4. **WebSocket connection:** Verify real-time updates work (open two browser tabs, change task in one, see update in the other)
5. **No stray processes:** Check for leftover Vite dev servers or conflicting processes before starting: `lsof -i :3000`

**Static code reviews (AI or human) cannot catch runtime issues.** You must test in a running browser.

### Common Integration Failures

These have broken production. Check for them:

- **Missing type exports:** Types added to `shared/` but not exported in barrel file
- **Hardcoded ports/URLs:** Frontend code assuming specific port instead of using `window.location`
- **CORS origin mismatches:** Dev-only origins in allowlist, production origin missing
- **CSP dev-only exceptions:** Security policies that only work in development mode
- **Response envelope mismatches:** API clients expecting raw JSON but server returns wrapped `{ data, error }` responses
- **Conflicting processes:** Vite dev server running on production port

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                         |
| ---------- | --------------------------------------------------- |
| `feat`     | A new feature                                       |
| `fix`      | A bug fix                                           |
| `docs`     | Documentation changes                               |
| `style`    | Code style (formatting, semicolons, etc.)           |
| `refactor` | Code change that doesn't fix a bug or add a feature |
| `perf`     | Performance improvement                             |
| `test`     | Adding or updating tests                            |
| `build`    | Build system or dependency changes                  |
| `ci`       | CI/CD configuration changes                         |
| `chore`    | Other changes (no src or test modification)         |

### Examples

```
feat(board): add drag-and-drop column reordering
fix(api): handle empty task list in export endpoint
docs: update README with deployment instructions
```

## Pull Request Process

1. **Fork** the repo and create your branch from `main`.
2. **Branch naming:** Use descriptive names like `feat/task-filters`, `fix/login-redirect`, `docs/api-reference`.
3. **Open a PR** against `main`.
4. **Fill out the PR template** — describe changes, link related issues, include screenshots for UI changes.
5. **Ensure the selected PR CI tier passes** — all checks started for the pull
   request must be green. The scope selector runs related tests for affected
   workspaces, escalates high-risk paths to the complete suite, and records its
   base/head evidence in the job summary. Use `ci:full` for release candidates
   or other changes that require an explicit complete-suite gate.
6. **Request review** — a maintainer will review and may request changes.
7. **Address feedback** — push additional commits as needed.
8. **Merge** — once approved, a maintainer will merge.

## Code Style

- **Language:** TypeScript (strict mode)
- **Linting:** ESLint — `pnpm lint`
- **Lint budget:** `pnpm lint:budget` enforces the current warning ceiling so lint debt cannot grow.
- **Formatting:** Prettier — `pnpm format`
- **Editor:** VS Code recommended with ESLint + Prettier extensions

Follow the existing conventions in `.eslintrc.*`, `.prettierrc`, and `tsconfig.json`.

## Testing

- **Run all tests:**

  ```bash
  pnpm test
  ```

- **End-to-end tests** use [Playwright](https://playwright.dev/):

  ```bash
  pnpm test:e2e
  ```

- **Load smoke tests** use [k6](https://k6.io/):

  ```bash
  pnpm test:load:smoke
  ```

- **Release readiness** checks workspace versions, changelog, README badge, build outputs, and optional GitHub tag/release state:

  ```bash
  pnpm validate:release
  pnpm validate:release -- --github
  ```

- Write tests for new features and bug fixes.
- Ensure existing tests pass before submitting.

### CI tiers

| Trigger                                                                                                     | Stable checks                                                   | Scope                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Documentation-only pull request or merge                                                                    | Static gates; unit-test jobs record skip decisions              | No workspace unit suite                                                                                 |
| Ordinary code pull request                                                                                  | `Lint & Type Check`, `Changed Tests`, `Build`, `Security Audit` | Vitest `related` coverage for affected server, web, CLI, or MCP workspaces                              |
| Ordinary code merge to `main`                                                                               | Default static gates plus `Changed Tests`                       | Related coverage limited to affected workspaces                                                         |
| Pull request with `ci:full`, or a high-risk CI/manifest/shared/storage/desktop change                       | Default checks plus `Workspace Unit Tests`                      | Complete workspace, desktop readiness regressions, and exact dual-storage parity                        |
| Merge whose reviewed head already passed `Workspace Unit Tests`                                             | Static gates; both unit-test tiers record skip decisions        | Reuses exact successful head evidence when that head is an ancestor of the merge commit                 |
| Nightly 08:00 UTC or manual `CI` dispatch with `test_scope=full`                                            | Static gates, `Workspace Unit Tests`, `Build`, `Security Audit` | Complete authoritative workspace suite                                                                  |
| Manual `CI` dispatch with `test_scope=focused` and optional `base_sha`                                      | Static gates plus the selected unit-test tier                   | Classifies `base_sha...HEAD` (or `HEAD^...HEAD`); high-risk paths still conservatively escalate to full |
| Desktop/package/release-workflow pull request, relevant `main` push, or manual `Desktop Artifacts` dispatch | Unsigned macOS, Linux, and Windows artifact jobs                | Cross-platform packaging                                                                                |

`Select Test Scope` is the decision record for each run. Its summary names the
event, exact base/head range, changed-path count, selected tier, affected
workspaces, and why `Changed Tests` or `Workspace Unit Tests` ran or skipped.
The selector fails safe to the complete suite for unknown non-documentation
paths and for changes to:

- GitHub Actions workflows and the selector itself
- package manifests, lockfiles, workspace configuration, and test configuration
- the shared package
- storage implementations and storage parity coverage
- the desktop package and desktop readiness boundary
- deletion of any non-documentation path, because related selection cannot
  reconstruct the deleted dependency graph

Run the selector contract locally with:

```bash
pnpm test:ci-scope
```

Release validation remains the final authority: clean-clone build, full unit
and integration suites, applicable E2E, and signed artifact verification.

The operational target for the default pull-request tier is under 15 minutes,
with no desktop packaging. This is a target rather than an SLA; dependency
installation and hosted-runner availability still vary. Behavior changes
should include coverage reachable from the changed source so Vitest's related
test selection can execute it.

## Questions?

Open a [GitHub Discussion](https://github.com/BradGroux/veritas-kanban/discussions) or reach out to the maintainers.

Thanks for contributing! 🎉
