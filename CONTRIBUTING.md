# Contributing to Veritas Kanban

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** 22 or later
- **pnpm** 9+ (package manager)

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

3. Run linting and tests before committing:

   ```bash
   pnpm lint
   pnpm test
   ```

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

### Pre-Merge Checklist

Before merging any branch, verify:

- [ ] **Type exports:** All new types added to `shared/` are exported in `shared/src/types/index.ts`
- [ ] **Builds pass:** `pnpm build` succeeds for all packages (shared, server, web)
- [ ] **No hardcoded values:** No hardcoded ports, URLs, or timeouts in application code
- [ ] **CSP/CORS configs:** Security policies work in both `NODE_ENV=development` AND `NODE_ENV=production`
- [ ] **Frontend hooks:** All HTTP calls use shared helpers (`apiFetch`) and all WebSocket/URL logic uses `window.location.host` (not hardcoded ports)
- [ ] **Environment variables:** All configurable values use env vars with sensible defaults

### Environment Rules

**Never change these without team agreement:**

- **PORT in `.env`:** Default is 3000. Changing this breaks developer workflows and bookmarks.
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
5. **Ensure CI passes** — all checks must be green.
6. **Request review** — a maintainer will review and may request changes.
7. **Address feedback** — push additional commits as needed.
8. **Merge** — once approved, a maintainer will merge.

## Code Style

- **Language:** TypeScript (strict mode)
- **Linting:** ESLint — `pnpm lint`
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

- Write tests for new features and bug fixes.
- Ensure existing tests pass before submitting.

## Questions?

Open a [GitHub Discussion](https://github.com/BradGroux/veritas-kanban/discussions) or reach out to the maintainers.

Thanks for contributing! 🎉
