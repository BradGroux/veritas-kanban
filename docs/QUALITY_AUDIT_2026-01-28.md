# Quality & DevOps Audit — 2026-01-28

**Auditor:** Veritas (AI Dev Agent)  
**Project:** veritas-kanban  
**Date:** January 28, 2026  
**Commit:** `b40ad0b` (feat(security): replace custom rate limiter with express-rate-limit)

---

## Executive Summary

| Category | Rating | Notes |
|----------|--------|-------|
| TypeScript Strictness | ✅ Pass | `strict: true`, clean compilation |
| Test Suite | 🔴 Critical | 10 of 41 test files failing; 0% frontend unit tests |
| Error Handling | 🟡 Medium | Good middleware, 39 silent catch blocks |
| Logging & Observability | 🟠 High | No structured logging, no request IDs |
| Dead Code & Hygiene | 🟡 Medium | 3 TODO items, large god-files |
| Accessibility | 🟠 High | Only 42 aria/role refs across 152 frontend files |
| CI/CD | 🔴 Critical | No CI pipeline exists |
| Dependencies | ✅ Pass | Only 1 outdated package |
| Documentation | 🟡 Medium | Good README; no API docs |
| Git Hygiene | ✅ Pass | Clean conventional commits |

**Overall Production Readiness: 🟠 NOT READY** — Broken tests and no CI pipeline are blockers.

---

## 1. TypeScript Strictness & Type Safety

### ✅ Pass — Compiler Configuration

Both `server/tsconfig.json` and `web/tsconfig.json` have `"strict": true`.

The web config adds extra strictness:
- `"noUnusedLocals": true`
- `"noUnusedParameters": true`
- `"noFallthroughCasesInSwitch": true`

**Both packages compile cleanly with `tsc --noEmit`.** Zero compiler errors.

### 🟡 Medium — `any` Type Usage

| Scope | `any` references (including comments/identifiers) | `as any` / `@ts-ignore` / `@ts-expect-error` |
|-------|-----|-----|
| Server (non-test) | 77 | 16 explicit `as any` casts |
| Web (non-test) | 43 | 7 |

**Notable `as any` locations:**
- `server/src/middleware/validate.ts:49` — `(req as any).validated` → should use module augmentation on Express `Request`
- `server/src/services/telemetry-service.ts:314-321` — 8 casts in CSV export → event type union is not properly narrowed
- `server/src/services/config-service.ts:93-212` — 5 casts for generic deep-merge logic → consider typed generics
- `server/src/services/managed-list-service.ts:105` — `(input as any).label` → input type should include `label`

**Recommendation:** The 16 `as any` casts in non-test server code should each get a `// SAFETY:` comment or be replaced with proper type narrowing. The telemetry service casts are the worst offenders (8 in a row).

---

## 2. Test Suite & Coverage

### 🔴 Critical — 10 of 41 Test Files Failing

**Result:** 31 passed, **10 FAILED**, 1 unhandled error  
**Tests:** 571 passed (all from the 31 working files)

#### Failing files — all share the same root cause:

Routes use `new TaskService()` at module scope (line ~9-14). The coverage test files try to mock the constructor with `vi.fn()` but the mock returns a non-constructible arrow function.

**Affected test files:**
| File | Root Cause |
|------|-----------|
| `routes/tasks-coverage.test.ts` | `new TaskService()` not mockable |
| `routes/task-comments-coverage.test.ts` | Same |
| `routes/task-subtasks-coverage.test.ts` | Same |
| `routes/task-time-coverage.test.ts` | Same |
| `routes/task-archive-coverage.test.ts` | Same |
| `routes/templates-coverage.test.ts` | `new TemplateService()` same pattern |
| `routes/config-coverage.test.ts` | `new ConfigService()` same pattern |
| `routes/notifications-coverage.test.ts` | Same |
| `routes/automation-coverage.test.ts` | Same |
| `routes/misc-routes-coverage.test.ts` | `mockActivityService` initialization order |

**Additional error:** `activity-service.test.ts` throws an unhandled rejection (`Cannot access 'tmpRoot' before initialization`) due to module-level singleton instantiation racing with the mock setup.

**Architecture Issue:** Routes instantiate services at module top-level (`const taskService = new TaskService()`). This makes mocking impossible without dependency injection. The working tests (31 files) either test pure functions or use proper DI patterns.

### 🟠 High — Test Coverage Ratio

| Metric | Count |
|--------|-------|
| Server test files | 41 |
| Server source files (non-test) | 78 |
| **Test:Source ratio** | **0.53:1** |
| Web test files | 1 (`sanitize.test.ts`) |
| Web source files | 152 |
| **Web test:source ratio** | **0.007:1** |
| E2E specs | 6 (Playwright) |

The server has decent test structure but the 10 broken files undermine confidence. The web has essentially **zero unit tests** (1 utility test out of 152 files). E2E tests exist (6 specs) but test results show prior failures.

**Test quality:** The 31 passing server tests are meaningful — they test real behavior (CRUD, auth flows, validation schemas, JWT rotation, migrations) with proper assertions. These aren't smoke tests.

---

## 3. Error Handling

### ✅ Pass — Error Middleware

`server/src/middleware/error-handler.ts` is well-structured:
- Custom `AppError` class hierarchy (`NotFoundError`, `ValidationError`, `ConflictError`)
- Proper Express 4-argument error handler registered last in `index.ts:237`
- Unhandled errors return generic 500 with no stack trace leak

### 🟡 Medium — Silent Catch Blocks

**39 empty catch blocks** across server source (non-test):

- `server/src/services/metrics-service.ts` — **8 empty catches** (lines 275, 700, 841, 960, 1047, 1219, 1365, 1531)
- `server/src/services/attachment-service.ts` — 5 empty catches
- `server/src/services/conflict-service.ts` — 3 empty catches
- `server/src/services/trace-service.ts` — 3 empty catches
- `server/src/services/status-history-service.ts` — 3 empty catches
- `server/src/middleware/auth.ts` — 2 empty catches
- Various others (1-2 each)

Most of these silently swallow file I/O errors (JSON parse failures, missing files). This is intentional for "best effort" operations but makes debugging production issues very difficult.

### 🟡 Medium — No `unhandledRejection` Handler

`server/src/index.ts` handles `SIGTERM` and `SIGINT` for graceful shutdown but **does not register `process.on('unhandledRejection')` or `process.on('uncaughtException')`**. In production, an unhandled promise rejection could crash the process silently (Node.js 22 default behavior).

---

## 4. Logging & Observability

### 🟠 High — No Structured Logging

**113 `console.log/error/warn` calls** in server source (non-test).

The project uses raw `console.*` throughout:
- `console.log('Security config saved')` (security.ts:301)
- `console.error('Failed to initialize services:', err)` (index.ts:251)
- `console.warn('CORS: Blocked request from origin:', origin)` (index.ts:124)

**No structured logging library** (pino, winston, bunyan). In production, these logs are:
- Not JSON-structured → hard to parse in log aggregators
- No log levels → can't filter by severity
- No timestamps → only if the runtime adds them
- No context → no request IDs, user IDs, or correlation data

### 🔴 Critical — No Request ID Tracking

**Zero references** to `requestId`, `request-id`, `x-request-id`, or `correlationId` in the codebase.

Without request ID tracking:
- Cannot correlate a frontend error to a server log entry
- Cannot trace a request through service layers
- Cannot debug production issues efficiently

### 🟡 Medium — Health Check is Minimal

```typescript
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

Returns static `ok` regardless of actual health. Should check:
- File system accessibility (can read/write task files)
- Disk space availability
- Memory usage
- WebSocket server status

---

## 5. Dead Code & Unused Exports

### 🟡 Medium — God Files

| File | Lines | Concern |
|------|-------|---------|
| `server/src/services/metrics-service.ts` | **1,669** | Massive — should be split |
| `server/src/services/task-service.ts` | 819 | Large but reasonable |
| `server/src/middleware/auth.ts` | 488 | Auth is complex, acceptable |
| `server/src/index.ts` | 463 | Express setup + WS, could extract WS |
| `server/src/routes/auth.ts` | 454 | Multiple auth flows |
| `web/src/lib/api.ts` | **1,038** | API client — should split by domain |

The metrics service at 1,669 lines is the worst offender. It handles telemetry aggregation, CSV export, statistical calculations, and data querying all in one file.

### 🟢 Low — TODO/FIXME Comments

Only **3 actionable TODOs** found:
- `web/src/components/task/ApplyTemplateDialog.tsx:86` — `author: 'Brad', // TODO: Get from user config`
- `web/src/components/task/ApplyTemplateDialog.tsx:199` — Same
- `web/src/hooks/useTemplateForm.ts:112` — Same

All are the same issue (hardcoded author). Low count is good.

### 🟡 Medium — Export Count

282 exports across server source. Without a dead-code elimination tool, some may be unused. Recommend running `ts-prune` or `knip` to identify unused exports.

---

## 6. Accessibility (Frontend)

### 🟠 High — Low Accessibility Coverage

| Metric | Count |
|--------|-------|
| `aria-*` or `role=` references | 42 |
| Frontend source files (.tsx) | ~100+ |
| `onKeyDown`/`tabIndex`/focus-related | 25 |
| `<img>` tags | 1 |
| `alt=` attributes | 1 |

42 ARIA references across the entire frontend is very low. The Settings components (Sprint 1150 docs mention WCAG 2.1 AA) likely account for most of them.

**Error boundaries** exist only in Settings:
- `SettingsErrorBoundary` wraps each settings tab
- No global ErrorBoundary for the app root or board view

**Keyboard navigation:** 25 keyboard-related refs is minimal for a drag-and-drop Kanban board. Key areas to check:
- Can users navigate task cards with Tab?
- Can users move tasks between columns with keyboard?
- Are drag-and-drop operations accessible?

### 🟢 Low — Hardcoded Colors

6 files contain inline color values. Since the project uses Tailwind CSS with a dark theme, most colors come from utility classes. The hardcoded ones are in charts/dashboards (TrendsCharts.tsx, AgentStatusIndicator.tsx) which typically need specific colors for data visualization.

---

## 7. CI/CD & DevOps Readiness

### 🔴 Critical — No CI Pipeline

**No `.github/workflows/`, `.gitlab-ci.yml`, or any CI configuration exists.**

This means:
- No automated test runs on PRs
- No lint checks on commit
- No build verification
- No deployment automation
- Broken tests can (and have) merged to `main`

### ✅ Pass — Docker Configuration

**Dockerfile** is excellent:
- Multi-stage build (5 stages: deps → build-shared → build-web → build-server → production)
- Non-root user (`veritas:nodejs`)
- Health check built in
- Layer caching optimized (lockfile copied first)
- Production-only dependencies in final stage
- Target size < 200MB

**docker-compose.yml** is clean:
- Persistent volume for task data
- Health check configured
- Environment variable documentation
- `restart: unless-stopped`

### 🟡 Medium — No Pre-Commit Hooks

No `.husky/` directory, no pre-commit configuration. ESLint config exists (`eslint.config.js`) with TypeScript and React rules, and Prettier is in devDependencies, but neither runs automatically on commit.

### ✅ Pass — Environment Config

- `server/.env.example` — Comprehensive (40+ lines with documentation)
- `web/.env.example` — Exists
- `.env` excluded from git in `.gitignore`
- `.devcontainer/devcontainer.json` exists for VS Code dev containers

---

## 8. Dependency Health

### ✅ Pass — Dependencies Are Current

```
┌───────────────────┬─────────┬────────┐
│ Package           │ Current │ Latest │
├───────────────────┼─────────┼────────┤
│ @types/node (dev) │ 22.19.7 │ 25.1.0 │
└───────────────────┴─────────┴────────┘
```

Only 1 outdated package and it's a `@types` dev dependency. Excellent.

### 🟡 Medium — Copyleft License Dependency

`jszip` uses `(MIT OR GPL-3.0-or-later)`. Since it's dual-licensed (OR), MIT can be chosen. But this should be documented in a LICENSE audit to avoid future confusion.

### 🟡 Medium — Large Binary Files in Git

Two PNG screenshots (568KB + 624KB) are tracked in Git:
```
tasks/archive-attachments/task_20260128_eyx3Mw/att_1769584968092_TNVwGo_Screenshot_2026-01-28_at_01.15.03.png  (624KB)
tasks/archive-attachments/task_20260128_eyx3Mw/att_1769584990443_K3qkAb_Screenshot_2026-01-28_at_01.06.41.png  (568KB)
```

Also tracked: telemetry NDJSON files (587KB growing):
```
.veritas-kanban/telemetry/events-2026-01-28.ndjson  (587KB, growing)
.veritas-kanban/telemetry/events-2026-01-26.ndjson  (25KB)
```

These should be in `.gitignore`. Telemetry data and attachments are runtime artifacts, not source code.

---

## 9. Documentation

### ✅ Pass — README

The README is comprehensive (~100 lines visible):
- Feature overview with emoji categories
- Quick start guide with `pnpm install && pnpm dev`
- Tech stack table
- Project structure tree
- API versioning section
- Environment variable documentation

### 🟡 Medium — No API Documentation

No Swagger/OpenAPI spec found. Zero references to `swagger`, `openapi`, or `@api` annotations in source.

The server has 20+ API endpoints across multiple route files. Without API docs:
- Frontend developers must read server code to understand request/response shapes
- No auto-generated client SDKs possible
- No API testing tools (Postman/Insomnia) can import the spec

### ✅ Pass — Architecture Docs

- `docs/security.md` — Security architecture
- `docs/settings-architecture.md` — Settings design
- `docs/sprint-*.md` — 14 sprint planning documents
- `docs/CODE_REVIEW_2026-01-28.md` — Previous code review
- `CHANGELOG.md` — Detailed changelog with semantic versioning

### 🟡 Medium — JSDoc Coverage

358 JSDoc comment blocks (`/**`) across server source — decent for 78 files (~4.6 per file average). However, much of this is in a few well-documented files while many route handlers lack documentation entirely.

---

## 10. Git Hygiene

### ✅ Pass — Commit Messages

Last 20 commits follow **Conventional Commits** format consistently:
```
feat(security): replace custom rate limiter with express-rate-limit
fix: add missing route imports in server index.ts (server crash fix)
perf: add in-memory task caching with file watchers
fix(security): add server-side MIME type validation for uploads
feat(deploy): add production Dockerfile with multi-stage build
```

Types used: `feat`, `fix`, `perf`, `docs` with appropriate scopes. Messages are descriptive and include context.

### ✅ Pass — .gitignore

Comprehensive coverage:
- `node_modules/`, `dist/`, `build/`
- `.env`, `.env.local`, `.env.*.local`
- IDE files, OS files
- Test coverage output
- Playwright artifacts
- TypeScript build info

**Gap:** Should add `tasks/archive-attachments/` and `.veritas-kanban/telemetry/` (see §8).

### ✅ Pass — Branch Strategy

Single `main` branch with two remotes (`work`, `personal`). Linear history with descriptive commits. Appropriate for a solo-developer project.

---

## Prioritized Action Items

### 🔴 Critical (Blocks Production)

1. **Fix 10 broken test files** — Routes need dependency injection refactor. Currently `new TaskService()` at module scope prevents mocking. Either:
   - Inject services via factory functions
   - Use `vi.mock()` with proper class constructor mocks
   - Move to integration tests with real (in-memory) service instances

2. **Add CI pipeline** — Create `.github/workflows/ci.yml`:
   ```yaml
   - pnpm install
   - pnpm lint
   - pnpm -r build
   - cd server && pnpm test
   - cd web && pnpm test  # once tests exist
   ```

3. **Add request ID middleware** — Critical for production debugging:
   ```typescript
   import { randomUUID } from 'crypto';
   app.use((req, res, next) => {
     req.id = req.headers['x-request-id'] || randomUUID();
     res.setHeader('x-request-id', req.id);
     next();
   });
   ```

### 🟠 High (Fix Before Release)

4. **Add structured logging** — Replace `console.*` with `pino`:
   - JSON output in production
   - Request context (ID, method, path, duration)
   - Log levels (trace/debug/info/warn/error/fatal)

5. **Add `unhandledRejection`/`uncaughtException` handlers** — in `index.ts`:
   ```typescript
   process.on('unhandledRejection', (reason) => {
     logger.fatal({ err: reason }, 'Unhandled rejection');
     process.exit(1);
   });
   ```

6. **Improve frontend accessibility** — Target WCAG 2.1 AA:
   - Add `aria-label` to all interactive elements
   - Add keyboard navigation for board columns
   - Add `role="region"` with labels for major UI sections
   - Add skip-to-content link
   - Add global ErrorBoundary

7. **Add frontend unit tests** — 1 test file for 152 source files is unacceptable. Start with:
   - API client (`api.ts` — 1,038 lines, zero tests)
   - Custom hooks (`useTemplateForm`, `useWebSocket`)
   - Complex components (`TaskCard`, `Dashboard`)

### 🟡 Medium (Improve Soon)

8. **Split god files:**
   - `metrics-service.ts` (1,669 lines) → `metrics-aggregator.ts`, `metrics-query.ts`, `metrics-export.ts`
   - `api.ts` (1,038 lines) → `api/tasks.ts`, `api/settings.ts`, `api/telemetry.ts`

9. **Replace `as any` casts** (16 in server):
   - `telemetry-service.ts:314-321` — Define proper discriminated union for CSV fields
   - `config-service.ts:93-212` — Use `Record<string, unknown>` with runtime checks
   - `validate.ts:49` — Extend Express `Request` interface

10. **Add `.gitignore` entries:**
    ```gitignore
    tasks/archive-attachments/
    .veritas-kanban/telemetry/
    ```

11. **Add pre-commit hooks** (husky + lint-staged):
    ```json
    { "lint-staged": { "*.{ts,tsx}": ["eslint --fix", "prettier --write"] } }
    ```

12. **Enhance health check** — Return actual system health:
    ```typescript
    app.get('/health', async (_req, res) => {
      const fsOk = await checkFileSystem();
      const status = fsOk ? 'ok' : 'degraded';
      res.status(fsOk ? 200 : 503).json({
        status, timestamp: new Date().toISOString(),
        checks: { filesystem: fsOk, uptime: process.uptime() }
      });
    });
    ```

13. **Audit silent catch blocks** — The 39 empty `catch {}` blocks (especially 8 in metrics-service) should at minimum log at debug level.

14. **Add API documentation** — Use `swagger-jsdoc` + `swagger-ui-express` or generate OpenAPI spec from Zod schemas (already in use for validation).

### 🟢 Low (Nice to Have)

15. **Run `knip`** to detect unused exports and dead code across the monorepo.
16. **Document license audit** — Note jszip's dual MIT/GPL-3.0 license in a LICENSES.md.
17. **Add contributor guide** — CONTRIBUTING.md with dev workflow, PR process, coding standards.
18. **Resolve the 3 TODO items** — Hardcoded `author: 'Brad'` in template dialog.

---

## Test Results Summary

```
Server Unit Tests:
  Test Files:  10 failed | 31 passed (41 total)
  Tests:       571 passed (from working files)
  Errors:      1 unhandled rejection
  Duration:    2.13s

Frontend Unit Tests:
  Test Files:  1 (sanitize.test.ts only)
  
E2E Tests (Playwright):
  Spec Files:  6 (health, settings, task-creation, task-detail, task-list, task-status)
  Status:      Prior failures in test-results/ directory
```

---

*Generated by Veritas Quality Audit • 2026-01-28T16:50:00-06:00*
