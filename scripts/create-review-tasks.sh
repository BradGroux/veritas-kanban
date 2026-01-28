#!/bin/bash
# Script to create remaining code review tasks
# Pauses between requests to avoid rate limiting

API="http://localhost:3001/api/tasks"

create_task() {
  local title="$1"
  local desc="$2"
  local priority="$3"
  
  curl -s -X POST "$API" -H "Content-Type: application/json" -d "{
    \"title\": \"$title\",
    \"description\": \"$desc\",
    \"type\": \"refactor-saXoty\",
    \"priority\": \"$priority\",
    \"project\": \"veritas-kanban\"
  }" > /dev/null
  
  echo "✓ Created: $title"
  sleep 1
}

echo "Creating remaining code review tasks..."

# Architecture tasks (remaining)
create_task "ARCH: Extract auth logic into centralized AuthService class" "**Issue:** Auth logic scattered across middleware/auth.ts, config/security.ts, routes/auth.ts.

**Files:** server/src/middleware/auth.ts, server/src/config/security.ts, server/src/routes/auth.ts

**Impact:** Hard to audit, maintain, and test. Duplication of logic.

**Fix:**
1. Create server/src/services/auth-service.ts
2. Move all auth logic: validateApiKey, verifyJwt, generateToken, etc.
3. AuthService class with methods: authenticate(), authorize(), issueToken(), validateSession()
4. Middleware becomes thin wrapper around AuthService
5. Easier to test (mock service, not middleware)
6. Easier to swap auth providers" "medium"

create_task "ARCH: Introduce repository pattern for TaskService" "**Issue:** TaskService directly reads/writes files with no abstraction layer.

**Files:** server/src/services/task-service.ts

**Impact:** Hard to test, cannot swap storage backends (e.g., DB, S3).

**Fix:**
1. Create interface: ITaskRepository with methods: find, findById, create, update, delete
2. Implement FileSystemTaskRepository (current logic)
3. TaskService depends on ITaskRepository, not file system
4. Easy to add: DatabaseTaskRepository, S3TaskRepository
5. Easy to test: MockTaskRepository
6. Dependency injection pattern" "medium"

create_task "ARCH: Centralize API client in web/src/lib/api.ts" "**Issue:** API calls scattered across hook files (web/src/hooks/useTasks.ts, etc.).

**Files:** web/src/hooks/useTasks.ts, web/src/hooks/useAgent.ts, etc.

**Impact:** Inconsistent error handling, hard to add global interceptors (auth, logging).

**Fix:**
1. Create or enhance web/src/lib/api.ts
2. Export api object with namespaced methods: api.tasks.list(), api.tasks.get(id)
3. Centralize fetch logic, error handling, auth headers
4. Add request/response interceptors
5. Add retry logic for transient failures
6. Easier to mock for tests" "medium"

create_task "ARCH: Extract WebSocket logic into WebSocketService class" "**Issue:** WebSocket connection management is inline in server/src/index.ts (lines 174-233).

**Files:** server/src/index.ts

**Impact:** Hard to test, extend, and maintain. Mixing concerns.

**Fix:**
1. Create server/src/services/websocket-service.ts
2. WebSocketService class with methods: init(wss), handleConnection(ws), subscribe(taskId, ws), broadcast(event)
3. Move all WebSocket logic out of index.ts
4. index.ts becomes: const wsService = new WebSocketService(); wsService.init(wss);
5. Easier to test with mock WebSocket
6. Easier to add new message types" "medium"

create_task "ARCH: Add OpenAPI/Swagger documentation for API" "**Issue:** No API documentation generated from code.

**Files:** server/src/routes/*.ts

**Impact:** Hard for consumers (CLI, MCP, external tools) to understand API surface.

**Fix:**
1. Install swagger: pnpm add swagger-jsdoc swagger-ui-express
2. Add JSDoc comments with OpenAPI annotations to routes
3. Generate spec: swagger-jsdoc -d spec.json server/src/routes/**/*.ts
4. Serve UI: app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec))
5. Document all endpoints, request/response schemas
6. Add to README: API docs at /api-docs" "medium"

# Testing tasks (remaining)
create_task "TESTING: Add frontend unit tests with Vitest and React Testing Library" "**Issue:** No frontend tests exist (web/src/ has no __tests__ folders).

**Impact:** Component regressions not caught, refactoring risky.

**Priority Components to Test:**
1. TaskCard - rendering, click handlers, drag behavior
2. KanbanBoard - filtering, column rendering
3. FilterBar - filter logic
4. SettingsDialog - tabs, validation
5. TaskDetailPanel - editing, saving

**Fix:**
1. Install: pnpm add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
2. Configure Vitest for React
3. Create web/src/__tests__/ directory
4. Write tests for each component
5. Target 60% coverage
6. Add to CI pipeline" "medium"

create_task "TESTING: Add WebSocket integration tests" "**Issue:** WebSocket logic not tested (connection, subscriptions, broadcasts).

**Files:** server/src/index.ts:174-233, server/src/services/broadcast-service.ts

**Impact:** Real-time updates may break without detection.

**Fix:**
1. Create server/src/__tests__/websocket.test.ts
2. Use ws client library to connect: new WebSocket('ws://localhost:3001/ws')
3. Test: connection with valid auth, rejection with invalid auth
4. Test: subscribe message, receive agent:output events
5. Test: task update triggers broadcast
6. Test: connection cleanup on disconnect
7. Run tests in CI" "medium"

create_task "TESTING: Add load/performance tests with k6 or Artillery" "**Issue:** No load testing exists. Performance under concurrent load unknown.

**Impact:** Production performance issues unknown (response times, memory leaks, rate limits).

**Fix:**
1. Install k6: brew install k6 (or Docker)
2. Create scripts/load-test.js
3. Test scenarios:
   - 100 concurrent users fetching task list
   - 50 users creating tasks simultaneously
   - WebSocket connections (100 concurrent)
   - Sustained load (1000 req/min for 10 min)
4. Measure: response time p50/p95/p99, error rate, memory usage
5. Set performance budgets: p95 < 500ms
6. Run before major releases" "medium"

# Deployment tasks (remaining)
create_task "DEPLOYMENT: Add CI/CD pipeline with GitHub Actions" "**Issue:** No CI/CD configuration. Deployments are manual, testing not automated.

**Impact:** High risk of shipping broken code, no deployment consistency.

**Fix:**
1. Create .github/workflows/ci.yml
2. Jobs:
   - lint: ESLint on all packages
   - typecheck: TypeScript compilation
   - test: Run Vitest tests, upload coverage
   - e2e: Run Playwright tests
   - build: Build server + web, verify no errors
3. Trigger on: push to main, PR
4. Add status badge to README
5. (Optional) Add deployment job: deploy to staging on main push" "medium"

create_task "DEPLOYMENT: Enhance health check for Kubernetes readiness/liveness" "**Issue:** /health endpoint exists but doesn't check dependencies (files, config).

**Files:** server/src/index.ts:71-73

**Impact:** K8s may route traffic to unhealthy instances.

**Fix:**
1. Create separate endpoints:
   - GET /health/live (liveness): basic server alive check
   - GET /health/ready (readiness): check dependencies
2. Readiness checks:
   - Can read tasks directory
   - Config file accessible
   - (Optional) WebSocket server running
3. Return 200 OK if healthy, 503 if not
4. Add to Kubernetes manifest: livenessProbe, readinessProbe
5. Document in docs/deployment.md" "medium"

create_task "DEPLOYMENT: Replace console.log with structured logging (Pino or Winston)" "**Issue:** All logging uses console.log() and console.error().

**Files:** server/src/**/*.ts (throughout)

**Impact:** Logs hard to parse in production, no JSON format for log aggregation.

**Fix:**
1. Install Pino: pnpm add pino pino-pretty
2. Create logger: const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
3. Replace console.log with logger.info(), console.error with logger.error()
4. Add request logging middleware: pino-http
5. Use logger.child({ module: 'TaskService' }) for context
6. Configure log levels per env (debug in dev, info in prod)
7. Document logging in README" "medium"

create_task "DEPLOYMENT: Add Prometheus metrics endpoint" "**Issue:** No metrics exposed for monitoring (Prometheus, Grafana).

**Impact:** Cannot diagnose production issues, no visibility into performance.

**Fix:**
1. Install prom-client: pnpm add prom-client
2. Create metrics: taskCreatedCounter, apiResponseTime histogram, activeWebSockets gauge
3. Expose endpoint: GET /metrics
4. Instrument key operations:
   - HTTP request duration by route
   - WebSocket connections (active, total)
   - Task operations (create, update, delete counts)
   - Cache hit/miss ratio
5. Document metrics in docs/observability.md
6. Add example Grafana dashboard JSON" "medium"

create_task "DEPLOYMENT: Optimize Vite build output (tree-shaking, code splitting)" "**Issue:** Vite config (web/vite.config.ts) lacks optimization settings.

**Files:** web/vite.config.ts

**Impact:** Larger frontend bundle than necessary.

**Fix:**
1. Enable build optimizations in vite.config.ts:
   - build.rollupOptions.output.manualChunks (split vendor chunks)
   - build.minify: 'terser'
   - build.sourcemap: false (in prod)
2. Analyze bundle: pnpm add -D rollup-plugin-visualizer
3. Lazy load routes with React.lazy()
4. Lazy load heavy components (Dashboard, DiffViewer)
5. Measure bundle size before/after
6. Target: main bundle < 200KB gzipped" "medium"

create_task "DEPLOYMENT: Add reverse proxy configuration examples (nginx, Caddy)" "**Issue:** No production deployment guides with reverse proxy configs.

**Impact:** Users don't know how to deploy securely behind proxy.

**Fix:**
1. Create docs/deployment.md
2. Add nginx example:
   - SSL termination
   - WebSocket proxying
   - Static file serving
   - Rate limiting
3. Add Caddy example (simpler, auto HTTPS)
4. Add Docker Compose example with nginx
5. Document environment variables for production
6. Add security checklist (HTTPS, secrets, firewall)" "medium"

create_task "DEPLOYMENT: Implement schema migration system for config changes" "**Issue:** No versioning for config schemas (.veritas-kanban/config.json, security.json).

**Files:** server/src/services/config-service.ts, server/src/config/security.ts

**Impact:** Breaking changes to config format could break existing deployments.

**Fix:**
1. Add schemaVersion field to all config files
2. Create migrations/ directory with migration scripts
3. On startup, check schemaVersion and run migrations if needed
4. Example: migration-v1-to-v2.ts renames fields, adds defaults
5. Similar to database migrations but for JSON files
6. Log migration status
7. Add migration tests" "medium"

create_task "DEPLOYMENT: Fail fast if CORS_ORIGINS not set in production" "**Issue:** CORS defaults to localhost if env var not set (server/src/index.ts:44-46).

**Files:** server/src/index.ts

**Impact:** Could accidentally allow localhost in production, security risk.

**Fix:**
1. Check NODE_ENV === 'production' && !process.env.CORS_ORIGINS
2. If true, throw error: 'CORS_ORIGINS must be set in production'
3. Exit with code 1
4. Document CORS_ORIGINS in .env.example
5. Update README with production setup checklist
6. Add validation for other critical env vars (JWT_SECRET, etc.)" "medium"

# Low priority tasks (Standards)
create_task "STANDARDS: Standardize error handling patterns across routes" "**Issue:** Some routes use try/catch, others rely on async-handler middleware.

**Files:** server/src/routes/*.ts

**Impact:** Inconsistent error responses, harder to debug.

**Fix:**
1. Audit all routes for error handling pattern
2. Choose one approach: all routes use async-handler OR all use try/catch
3. Recommendation: Use async-handler for consistency
4. Update all routes to match chosen pattern
5. Document in CONTRIBUTING.md
6. Add ESLint rule to enforce (custom or existing)" "low"

create_task "STANDARDS: Remove TypeScript 'any' types with proper types or 'unknown'" "**Issue:** Some 'any' types bypass strict mode safety.

**Files:** Various (needs full audit)

**Impact:** Runtime errors not caught at compile time.

**Fix:**
1. Run: grep -r 'any' server/src/ web/src/ --include='*.ts' --include='*.tsx'
2. Review each occurrence
3. Replace with proper type or 'unknown' if type is truly unknown
4. Add ESLint rule: @typescript-eslint/no-explicit-any set to error
5. Ensure CI fails on 'any' usage
6. Document in CONTRIBUTING.md" "low"

create_task "STANDARDS: Add JSDoc comments for all public service methods" "**Issue:** Public methods lack JSDoc documentation.

**Files:** server/src/services/*.ts

**Impact:** Poor developer experience, hard to understand APIs without reading source.

**Fix:**
1. Add JSDoc to all public methods in services
2. Include: description, @param for each parameter, @returns, @throws
3. Example format:
   /**
    * Create a new task
    * @param input - Task creation data
    * @returns Created task with generated ID
    * @throws ValidationError if input is invalid
    */
4. Consider generating docs with TypeDoc
5. Add JSDoc linting to CI" "low"

create_task "STANDARDS: Standardize file naming conventions" "**Issue:** Mix of camelCase and kebab-case for file names.

**Files:** Various

**Impact:** Harder to locate files, inconsistent style.

**Fix:**
1. Establish convention:
   - Services: kebab-case (task-service.ts)
   - Components: PascalCase (TaskCard.tsx)
   - Utilities: kebab-case (format-date.ts)
   - Types: kebab-case (task.types.ts)
2. Rename files to match convention
3. Update all imports
4. Document in CONTRIBUTING.md
5. Add to style guide" "low"

create_task "STANDARDS: Extract magic numbers to constants file" "**Issue:** Hard-coded values scattered throughout code (10000 for polling, 1mb for body limit).

**Files:** Various

**Impact:** Hard to change, unclear intent.

**Fix:**
1. Create server/src/config/constants.ts and web/src/lib/constants.ts
2. Extract common values:
   - POLLING_INTERVAL_MS = 10000
   - BODY_LIMIT = '1mb'
   - RATE_LIMIT_WINDOW_MS = 60000
   - CACHE_TTL_MS = 5000
3. Replace all hard-coded values with named constants
4. Export and import where needed
5. Document each constant" "low"

create_task "STANDARDS: Remove unused imports with ESLint auto-fix" "**Issue:** Dead code from unused imports increases bundle size.

**Files:** Various

**Impact:** Marginally larger bundles, cluttered code.

**Fix:**
1. Run: pnpm lint --fix (should remove unused imports)
2. If not configured, add ESLint rule: @typescript-eslint/no-unused-vars
3. Run on all packages: pnpm -r lint --fix
4. Commit cleaned up code
5. Add pre-commit hook to prevent unused imports
6. Configure IDE to highlight unused imports" "low"

echo ""
echo "✅ All tasks created successfully!"
echo "Total tasks created: 41"
