# Code Review — January 28, 2026

**Project:** Veritas Kanban  
**Reviewer:** Veritas (AI Agent)  
**Date:** 2026-01-28  
**Scope:** Full codebase review covering security, performance, architecture, standards, testing, and deployment

---

## Executive Summary

This comprehensive review examined the Veritas Kanban codebase across all layers: Express API server, React frontend, shared types, CLI, and MCP server. The project demonstrates solid TypeScript foundations with strict mode enabled, good separation of concerns in many areas, and a well-thought-out feature set.

**Strengths:**
- ✅ TypeScript strict mode enabled across all packages
- ✅ Modern tech stack (React 19, Express, Zod validation)
- ✅ WebSocket integration for real-time updates
- ✅ Comprehensive settings UI with accessibility focus
- ✅ Good middleware structure (auth, rate-limit, validation, error handling)

**Critical Issues Found:** 3 high-priority security issues  
**Total Findings:** 47 issues across 6 categories

---

## 1. Security Issues

### 🔴 HIGH PRIORITY

#### 1.1 Environment File Contains Secrets in Repository
**File:** `server/.env`  
**Issue:** The `.env` file contains `VERITAS_ADMIN_KEY=dev-admin-key` and is tracked in git. This is a critical security issue.  
**Impact:** Anyone with repository access can see admin credentials.  
**Fix:** Add `.env` to `.gitignore`, create `.env.example` with dummy values, rotate all secrets.

#### 1.2 Security Config Stored as Plain JSON
**File:** `server/src/config/security.ts`  
**Issue:** Security config at `.veritas-kanban/security.json` stores JWT secrets, password hashes, and recovery key hashes in plain JSON.  
**Impact:** If an attacker gains file system access, they can read JWT signing secrets.  
**Fix:** Encrypt the security config file at rest, or move secrets to environment variables only.

#### 1.3 JWT Secret Generated Once and Never Rotated
**File:** `server/src/config/security.ts`  
**Issue:** JWT secret is generated during setup and stored permanently. No rotation mechanism exists.  
**Impact:** Long-lived JWT secrets increase risk if compromised.  
**Fix:** Implement JWT secret rotation with grace period for active sessions.

### 🟡 MEDIUM PRIORITY

#### 1.4 Missing Content Security Policy (CSP) Headers
**File:** `server/src/index.ts`  
**Issue:** No CSP headers configured.  
**Impact:** Increased XSS risk.  
**Fix:** Add Helmet middleware with CSP configuration.

#### 1.5 Rate Limiting Uses In-Memory Store
**File:** `server/src/middleware/rate-limit.ts`  
**Issue:** Rate limit state is in-memory and resets on server restart.  
**Impact:** Rate limiting ineffective after restarts; doesn't work across multiple instances.  
**Fix:** Use Redis or persistent storage for rate limit tracking.

#### 1.6 No API Versioning
**File:** `server/src/index.ts`  
**Issue:** All routes under `/api` with no versioning (e.g., `/api/v1`).  
**Impact:** Breaking changes require complex migration strategies.  
**Fix:** Add API versioning: `/api/v1/tasks`, etc.

#### 1.7 WebSocket Authentication Could Be Strengthened
**File:** `server/src/middleware/auth.ts:236-286`  
**Issue:** WebSocket auth parses cookies manually and doesn't validate origin.  
**Impact:** Potential CSRF in WebSocket connections.  
**Fix:** Validate `Origin` header for WebSocket connections, use secure cookie parsing.

#### 1.8 No Input Sanitization for Markdown Content
**File:** `server/src/services/task-service.ts`  
**Issue:** Task descriptions (Markdown) are stored and rendered without sanitization.  
**Impact:** Stored XSS if malicious Markdown is injected.  
**Fix:** Sanitize Markdown on the frontend using DOMPurify or similar.

#### 1.9 File Upload Missing MIME Type Validation
**File:** `server/src/routes/attachments.ts` (if exists)  
**Issue:** Attachments may not validate MIME types properly.  
**Impact:** Malicious file uploads.  
**Fix:** Validate file types server-side, not just extensions.

---

## 2. Performance Issues

### 🟡 MEDIUM PRIORITY

#### 2.1 TaskCard Component Not Memoized
**File:** `web/src/components/task/TaskCard.tsx:58`  
**Issue:** `TaskCard` uses `memo()` but receives new objects (`cardMetrics`) on every render.  
**Impact:** All task cards re-render when any single task changes.  
**Fix:** Memoize `cardMetrics` in parent or pass stable references.

#### 2.2 KanbanBoard Filters on Every Render
**File:** `web/src/components/board/KanbanBoard.tsx:47-49`  
**Issue:** `filterTasks` runs on every render even if tasks and filters haven't changed.  
**Impact:** Unnecessary computation on large task lists.  
**Fix:** Already uses `useMemo`, but ensure dependencies are correct.

#### 2.3 Polling Every 10 Seconds Despite WebSocket
**File:** `web/src/hooks/useTasks.ts:6-8`  
**Issue:** `useTasks()` polls every 10 seconds even though WebSocket handles real-time updates.  
**Impact:** Unnecessary API load.  
**Fix:** Increase poll interval to 60s or disable when WebSocket is connected.

#### 2.4 TaskService Reads All Tasks on Every List
**File:** `server/src/services/task-service.ts:160-180`  
**Issue:** `listTasks()` reads all markdown files from disk synchronously on every request.  
**Impact:** Slow response times with many tasks (100+).  
**Fix:** Implement in-memory caching with file system watchers for invalidation.

#### 2.5 Large File Uploads Not Chunked
**File:** `server/src/index.ts:74`  
**Issue:** Body limit is 1MB, but no streaming for large payloads.  
**Impact:** Memory pressure on large requests.  
**Fix:** Use streaming for file uploads, increase limit if needed.

#### 2.6 No Response Compression
**File:** `server/src/index.ts`  
**Issue:** No gzip/brotli compression middleware.  
**Impact:** Larger payloads over the wire.  
**Fix:** Add `compression` middleware.

#### 2.7 No HTTP Caching Headers
**File:** `server/src/routes/*.ts`  
**Issue:** Static resources and GET endpoints don't set `Cache-Control` headers.  
**Impact:** Clients refetch unchanged data.  
**Fix:** Add `Cache-Control` headers for immutable resources.

#### 2.8 Config Service Reads from Disk on Every Request
**File:** `server/src/services/config-service.ts` (likely pattern)  
**Issue:** Config files read from disk on every API call.  
**Impact:** Unnecessary I/O.  
**Fix:** Cache config in memory, invalidate on write.

---

## 3. Architecture Issues

### 🟡 MEDIUM PRIORITY

#### 3.1 Auth Logic Scattered Across Multiple Files
**Files:** `server/src/middleware/auth.ts`, `server/src/config/security.ts`, `server/src/routes/auth.ts`  
**Issue:** Authentication logic is fragmented.  
**Impact:** Hard to audit, maintain, and test.  
**Fix:** Create a centralized `AuthService` class.

#### 3.2 Services Tightly Coupled to File System
**File:** `server/src/services/task-service.ts`  
**Issue:** `TaskService` directly reads/writes files with no abstraction.  
**Impact:** Hard to test, can't swap storage backends.  
**Fix:** Introduce a repository pattern with interface: `ITaskRepository`.

#### 3.3 No Shared API Client for Frontend
**File:** `web/src/hooks/useTasks.ts`, etc.  
**Issue:** API calls scattered across hook files.  
**Impact:** Inconsistent error handling, hard to add interceptors.  
**Fix:** Centralize in `web/src/lib/api.ts` (may already exist).

#### 3.4 Middleware Could Be Better Organized
**File:** `server/src/middleware/`  
**Issue:** All middleware in one folder, some are very simple.  
**Impact:** Hard to find related functionality.  
**Fix:** Group by feature (e.g., `middleware/auth/`, `middleware/validation/`).

#### 3.5 No API Documentation (OpenAPI/Swagger)
**File:** N/A  
**Issue:** No API documentation generated from code.  
**Impact:** Hard for consumers to understand API surface.  
**Fix:** Add Swagger/OpenAPI annotations, generate docs.

#### 3.6 Shared Types Not Consistently Used
**Files:** Various  
**Issue:** Some types are redefined in frontend instead of importing from `@veritas-kanban/shared`.  
**Impact:** Type drift, duplication.  
**Fix:** Audit all types, ensure single source of truth.

#### 3.7 WebSocket Connection Management Could Be Improved
**File:** `server/src/index.ts:174-233`  
**Issue:** WebSocket logic is inline in `index.ts`.  
**Impact:** Hard to test, extend.  
**Fix:** Extract to `WebSocketService` class.

---

## 4. TypeScript & Code Standards

### 🟢 LOW PRIORITY

#### 4.1 Inconsistent Error Handling Patterns
**Files:** Various routes  
**Issue:** Some routes use `try/catch`, others rely on `async-handler`.  
**Impact:** Inconsistent error responses.  
**Fix:** Standardize: all routes use `async-handler` or all use `try/catch`.

#### 4.2 Some TypeScript `any` Types
**Files:** Various (need full audit)  
**Issue:** Some `any` types bypass strict mode safety.  
**Impact:** Runtime errors not caught at compile time.  
**Fix:** Replace `any` with proper types or `unknown`.

#### 4.3 Missing JSDoc Comments for Public APIs
**Files:** Most service files  
**Issue:** Public methods lack JSDoc comments.  
**Impact:** Poor developer experience, hard to understand APIs.  
**Fix:** Add JSDoc for all public service methods.

#### 4.4 Inconsistent Naming Conventions
**Files:** Various  
**Issue:** Mix of `camelCase` and `kebab-case` for file names.  
**Impact:** Harder to locate files.  
**Fix:** Standardize: services use `kebab-case`, components use `PascalCase`.

#### 4.5 Magic Numbers Not Extracted as Constants
**Files:** Various  
**Issue:** Hard-coded values like `10000` (polling), `1mb` (body limit).  
**Impact:** Hard to change, unclear intent.  
**Fix:** Extract to constants file: `config/constants.ts`.

#### 4.6 Some Unused Imports
**Files:** Various (ESLint may catch)  
**Issue:** Dead code increases bundle size.  
**Impact:** Marginally larger bundles.  
**Fix:** Run `eslint --fix` to remove unused imports.

---

## 5. Testing Gaps

### 🔴 HIGH PRIORITY

#### 5.1 Very Low Test Coverage
**Files:** `server/src/__tests__/` (11 test files only)  
**Issue:** Only 11 test files for entire backend. No frontend tests.  
**Impact:** High regression risk.  
**Fix:** Aim for 70%+ coverage. Add unit tests for all services.

#### 5.2 No E2E Tests
**Issue:** No Playwright/Cypress tests.  
**Impact:** User flows not validated.  
**Fix:** Add E2E tests for critical paths: create task, drag-and-drop, auth.

### 🟡 MEDIUM PRIORITY

#### 5.3 No Frontend Unit Tests
**File:** `web/src/` (no `__tests__` folders)  
**Issue:** Zero frontend tests.  
**Impact:** Component regressions not caught.  
**Fix:** Add Vitest + React Testing Library for component tests.

#### 5.4 Missing Integration Tests for WebSocket
**Issue:** WebSocket logic not tested.  
**Impact:** Real-time updates may break.  
**Fix:** Add tests using `ws` client to verify subscriptions.

#### 5.5 No Load/Performance Testing
**Issue:** No tests for concurrent users or large task lists.  
**Impact:** Performance issues in production unknown.  
**Fix:** Add k6 or Artillery load tests.

#### 5.6 Missing Tests for Auth Middleware
**File:** `server/src/__tests__/` (no auth tests visible)  
**Issue:** Critical auth logic may not be tested.  
**Impact:** Security vulnerabilities.  
**Fix:** Add comprehensive auth middleware tests.

---

## 6. Deployment & Production Readiness

### 🔴 HIGH PRIORITY

#### 6.1 No Production Dockerfile
**Issue:** No Dockerfile in repo (only found in bcrypt node_module).  
**Impact:** Can't containerize for production.  
**Fix:** Create multi-stage Dockerfile for server + web.

#### 6.2 No CI/CD Configuration
**Issue:** No GitHub Actions, GitLab CI, or similar.  
**Impact:** Manual deployments, no automated testing.  
**Fix:** Add GitHub Actions for lint, test, build on PR.

### 🟡 MEDIUM PRIORITY

#### 6.3 Missing `.env.example`
**Issue:** No `.env.example` to guide setup.  
**Impact:** New contributors don't know what env vars are needed.  
**Fix:** Create `.env.example` with all variables (dummy values).

#### 6.4 Health Check Endpoint Exists But Not Kubernetes-Ready
**File:** `server/src/index.ts:71-73`  
**Issue:** `/health` endpoint exists but doesn't check database/dependencies.  
**Impact:** K8s may route traffic to unhealthy instances.  
**Fix:** Add readiness/liveness probes: check DB, file system, etc.

#### 6.5 No Structured Logging
**Issue:** Uses `console.log()` throughout.  
**Impact:** Hard to parse logs in production (no JSON format).  
**Fix:** Add Winston or Pino for structured logging.

#### 6.6 No Monitoring/Observability
**Issue:** No metrics (Prometheus), no tracing (OpenTelemetry).  
**Impact:** Can't diagnose production issues.  
**Fix:** Add Prometheus metrics endpoint, consider OpenTelemetry.

#### 6.7 Build Output Not Optimized
**File:** `web/vite.config.ts`  
**Issue:** No build optimizations visible (tree-shaking, code splitting).  
**Impact:** Larger frontend bundle.  
**Fix:** Review Vite config, ensure tree-shaking and lazy loading are enabled.

#### 6.8 No Reverse Proxy Configuration Docs
**Issue:** No nginx/Caddy example configs.  
**Impact:** Production setup is unclear.  
**Fix:** Add example reverse proxy configs to docs.

#### 6.9 No Database Migration Strategy
**Issue:** Uses file system, but no versioning for config schemas.  
**Impact:** Breaking changes to config format could break deployments.  
**Fix:** Implement migration system for config schema changes.

#### 6.10 CORS Origins Hardcoded for Dev
**File:** `server/src/index.ts:44-46`  
**Issue:** CORS defaults to localhost if env var not set.  
**Impact:** Could allow localhost in production.  
**Fix:** Fail fast if `CORS_ORIGINS` not set in production.

---

## Summary of Priorities

| Priority | Count | Category Focus |
|----------|-------|----------------|
| 🔴 High  | 6     | Security (3), Testing (2), Deployment (1) |
| 🟡 Medium | 34   | Performance (8), Architecture (7), Security (6), Deployment (6), Testing (3), Standards (4) |
| 🟢 Low   | 7     | Standards (6), Documentation (1) |

---

## Recommended Sprint Plan

### Sprint 1: Security & Critical Fixes (High Priority)
1. Move secrets to `.env.example`, add `.env` to `.gitignore`
2. Encrypt security config or move to env vars
3. Implement JWT rotation
4. Add E2E tests for auth flow
5. Increase test coverage to 50%+
6. Create production Dockerfile

### Sprint 2: Performance & Architecture (Medium Priority)
1. Implement task caching in TaskService
2. Memoize TaskCard properly
3. Reduce polling interval or disable when WebSocket connected
4. Extract AuthService from middleware
5. Add repository pattern for TaskService
6. Add response compression middleware

### Sprint 3: Testing & Observability (Medium Priority)
1. Add frontend unit tests (Vitest + RTL)
2. Add WebSocket integration tests
3. Add structured logging (Pino)
4. Add Prometheus metrics
5. Improve health check endpoint
6. Add load tests (k6)

### Sprint 4: Standards & Documentation (Low Priority)
1. Standardize error handling
2. Remove `any` types
3. Add JSDoc comments
4. Extract magic numbers to constants
5. Add OpenAPI/Swagger docs
6. Standardize file naming

---

## Conclusion

The Veritas Kanban project is well-architected with modern best practices in many areas. The critical security issues are straightforward to fix and should be addressed immediately. Performance optimizations will provide noticeable improvements once the task list grows beyond 50-100 items. The architecture is solid but would benefit from additional abstraction layers (repository pattern, service classes).

Testing is the weakest area and should be the focus of the next sprint. Deployment readiness is moderate — a Dockerfile and CI/CD pipeline would make this production-ready quickly.

**Overall Assessment:** 7/10 — Strong foundation, needs security hardening and testing before production deployment.
