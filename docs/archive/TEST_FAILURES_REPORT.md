# CI Test Failures Report — Feb 8, 2026

## Summary

**TypeCheck Status**: ✅ PASSING (0 errors)  
**Lint Status**: ✅ PASSING (warnings only)  
**Build Status**: ✅ PASSING  
**Test Status**: ❌ 85 failures (out of 1244 tests)

## Root Cause

Major service refactoring in v2.1.0 broke test compatibility:

### 1. Agent Registry Service (29 failures)

- **Changed**: Direct instantiation → Singleton pattern
- **Breaking Change**: `new AgentRegistryService()` → `getAgentRegistryService()`
- **Impact**: All agent-registry-service.test.ts and agent-registry.test.ts tests fail
- **Files**:
  - `src/__tests__/services/agent-registry-service.test.ts` (29 tests)
  - `src/__tests__/routes/agent-registry.test.ts` (19 tests)

### 2. Notification Service (22 failures)

- **Changed**: Complete API redesign (general notifications → @mention-based system)
- **Breaking Changes**:
  - Removed: `loadNotifications()`, `saveNotifications()`, `clearNotifications()`, `markAsSent()`, `formatForTeams()`, `getPendingForTeams()`, `checkTasksForNotifications()`
  - New API: `createNotification()`, `getNotifications()`, `deliverNotification()`, `getStats()`, `subscribe()`, `getSubscriptions()`
  - Changed notification structure: type changed from `'agent_complete'` to `'mention'` etc.
- **Impact**: All notification-service.test.ts and notifications-coverage.test.ts tests fail
- **Files**:
  - `src/__tests__/notification-service.test.ts` (22 tests)
  - `src/__tests__/routes/notifications-coverage.test.ts` (11 tests)

### 3. Auth Middleware (3 failures)

- API key generation format changed (now includes `-` and `_` characters)
- X-Forwarded-For localhost detection logic changed
- **Files**:
  - `src/__tests__/middleware/auth.test.ts` (3 tests)

### 4. Schema Defaults (1 failure)

- Metrics period default changed from `24h` to `7d`
- **Files**:
  - `src/__tests__/schemas.test.ts` (1 test)

## Recommendation

### Option 1: Update Test Suite (Recommended)

Refactor failing tests to match new service APIs:

- Update agent-registry tests to use singleton accessors
- Rewrite notification tests for new @mention-based API
- Fix auth and schema test expectations

**Effort**: ~4-6 hours  
**Impact**: Full CI green

### Option 2: Document & Defer (Current)

Document known test failures, merge with passing typecheck/lint/build.
Fix tests incrementally in follow-up PRs.

**Effort**: Immediate (documented)  
**Impact**: CI shows test failures but typecheck badge green

## CI Jobs Status

| Job               | Status  | Notes                            |
| ----------------- | ------- | -------------------------------- |
| Lint & Type Check | ✅ PASS | All packages type-safe           |
| Build             | ✅ PASS | All packages build successfully  |
| Server Tests      | ❌ FAIL | 85/1244 failures (93% pass rate) |
| Security Audit    | ⚠️ N/A  | Not tested in this session       |

## Files Requiring Test Updates

```
server/src/__tests__/services/agent-registry-service.test.ts
server/src/__tests__/routes/agent-registry.test.ts
server/src/__tests__/notification-service.test.ts
server/src/__tests__/routes/notifications-coverage.test.ts
server/src/__tests__/middleware/auth.test.ts
server/src/__tests__/schemas.test.ts
```

## Next Steps

1. **Immediate**: Commit this report + typecheck success
2. **Follow-up**: Create task for test suite refactoring
3. **Priority**: Agent registry tests (most critical infrastructure)
4. **Secondary**: Notification tests (new feature, non-blocking)
