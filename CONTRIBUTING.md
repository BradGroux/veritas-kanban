# Contributing to Veritas Kanban

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** 20 or later
- **pnpm** (package manager)

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
   cp .env.example .env
   ```

   Edit `.env` with your local configuration.

5. **Start the development server:**
   ```bash
   pnpm dev
   ```

## Project Structure

Veritas Kanban is a monorepo:

```
veritas-kanban/
├── server/     # Backend API (Express + TypeScript)
├── web/        # Frontend UI (React + Vite + TypeScript)
├── shared/     # Shared types, utilities, constants
├── scripts/    # Build and utility scripts
└── ...
```

## Development Workflow

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
