# Incident Report: Parallel Merge Integration Failures

**Date:** 2026-02-07  
**Severity:** High (production broken for ~1 hour)  
**Root Cause:** Batch-merging 5 parallel feature branches without integration testing

---

## What Happened

Five feature branches were developed in parallel by sub-agents and merged to `main` in rapid succession. The application built successfully but failed at runtime with multiple cascading integration failures:

1. Type imports failed (missing exports)
2. Port mismatch broke developer workflow
3. CORS blocked production mode
4. CSP blocked WebSocket in production
5. Frontend hardcoded wrong WebSocket port
6. Auth API calls failed (response envelope mismatch)
7. Stray Vite dev server intercepted traffic
8. Hardcoded URLs throughout codebase
9. Code reviews passed but site didn't load
10. Orchestrator spent 10+ minutes debugging instead of delegating

**Time to recovery:** ~1 hour  
**Developer experience:** Extremely frustrating — site appeared to build successfully but was completely broken in the browser.

---

## Timeline

| Time    | Event                                                  |
| ------- | ------------------------------------------------------ |
| Morning | 5 feature branches developed in parallel by sub-agents |
| ~08:00  | All 5 branches merged to `main` in rapid succession    |
| ~08:05  | Build passes ✅                                        |
| ~08:06  | Static code review (Sonnet) passes ✅                  |
| ~08:07  | Static code review (Codex) passes ✅                   |
| ~08:08  | Developer loads site in browser → broken ❌            |
| ~08:10  | Begin debugging cascade of integration failures        |
| ~09:00  | All issues identified and fixed                        |
| ~09:10  | Post-mortem documentation begins                       |

---

## Root Causes

### 1. Missing Type Exports

**What:** Feature branches added new types to `shared/src/types/` but didn't update `shared/src/types/index.ts` (barrel file).  
**Why:** Each branch worked in isolation. After merging, other code importing from `shared/types` couldn't resolve the new types.  
**Impact:** Build failures in dependent packages (server, web).

### 2. PORT Changed Without Agreement

**What:** A sub-agent changed `server/.env` from `PORT=3000` to `PORT=3001`.  
**Why:** Unknown — possibly to avoid a conflict during parallel development.  
**Impact:** Developer's bookmarks/workflows broke. localhost:3000 no longer worked.

### 3. CORS Missing Production Origin

**What:** `CORS_ORIGINS` env var only included `:5173` (Vite dev) and `:3000` (for dev mode). In production mode, Express serves the frontend from `:3000`, which became the browser's `Origin` header.  
**Why:** CORS config was written for dev mode only.  
**Impact:** All API calls blocked by browser in production mode.

### 4. CSP Blocked WebSocket in Production

**What:** Content Security Policy `connect-src` directive only allowed `ws://localhost:*` inside an `if (isDev)` block.  
**Why:** Security policy was dev-only.  
**Impact:** WebSocket connections failed silently in production mode. Real-time updates didn't work.

### 5. WebSocket Hook Hardcoded Port

**What:** `web/src/hooks/useWebSocket.ts` had logic like:

```ts
const port = window.location.port === '3000' ? 3001 : 3000;
```

**Why:** Tried to "guess" the right port based on the current port.  
**Impact:** Always connected to the wrong port. Should use `window.location.host` directly.

### 6. Auth Hook Response Envelope Mismatch

**What:** `web/src/hooks/useAuth.tsx` had its own `fetchApi` helper that expected raw JSON. After response envelope middleware was added to the server, auth endpoints returned `{ data, error }` wrappers.  
**Why:** Auth hook wasn't updated to use the shared `apiFetch` helper.  
**Impact:** Login failed — hook couldn't parse the response.

### 7. Stray Vite Dev Server

**What:** A Vite dev server was running on port 3000, intercepting all requests and proxying them incorrectly.  
**Why:** Not killed from a previous dev session.  
**Impact:** Express production server couldn't bind to port 3000. All requests went to the wrong backend.

### 8. Hardcoded Values Throughout Codebase

**What:** Agent callback URLs, API client defaults, Swagger base URL all hardcoded to `localhost:3001`. Various timeouts and limits were magic numbers.  
**Why:** Quick-and-dirty development without env var abstraction.  
**Impact:** Every hardcoded value had to be hunted down and fixed manually.

### 9. Static Code Reviews Missed Runtime Issues

**What:** Two separate AI code reviews (Sonnet + Codex) both said "builds clean, safe to commit."  
**Why:** Reviews only checked for syntax, type errors, and lint violations. They didn't test runtime behavior.  
**Impact:** False confidence. "Passes review" meant nothing.

### 10. Orchestrator Did Worker Tasks

**What:** Main agent (VERITAS/Opus) spent 10+ minutes doing hands-on debugging instead of delegating to sub-agents.  
**Why:** Unclear — possibly urgency, possibly unclear delegation strategy.  
**Impact:** Main agent was unavailable for communication with the human during debugging. Waste of Opus-level reasoning on implementation work.

---

## What We Learned

### Lesson 1: Batch-Merging Parallel Branches is a Trap

**The problem:** Each branch works in isolation. Integration issues only appear after merging. Batch-merging hides which branch introduced which problem.

**The fix:** Merge one branch at a time. Build + smoke test between each merge.

**Why it works:** When something breaks, you know exactly which branch caused it.

### Lesson 2: "Builds Clean" ≠ "Works"

**The problem:** TypeScript, ESLint, and AI code reviews all passed. The site still didn't load.

**The fix:** Smoke test runtime behavior before merging:

- Health check
- Auth flow
- Task CRUD
- WebSocket connection
- Check for stray processes

**Why it works:** Static analysis can't catch integration issues, hardcoded values, or CORS/CSP misconfigurations.

### Lesson 3: Environment Variables Exist for a Reason

**The problem:** Hardcoded ports, URLs, and magic numbers scattered throughout the codebase.

**The fix:**

- Never hardcode ports or URLs in application code
- All configurable values → env vars with sensible defaults
- Document what each env var does

**Why it works:** Changing one .env file is easier than hunting down 20 hardcoded values.

### Lesson 4: Dev-Only Security Policies Break Production

**The problem:** CSP and CORS configs worked in dev but blocked everything in production.

**The fix:**

- CORS must include the production serving origin
- CSP must allow necessary connections (WebSocket) in all modes
- Test in `NODE_ENV=production` before merging

**Why it works:** Security policies that only work in dev mode aren't security policies — they're bugs waiting to happen.

### Lesson 5: Shared Helpers Exist for a Reason

**The problem:** Auth hook had its own `fetchApi` that didn't match the shared helper. When the API response format changed, only the shared helper was updated.

**The fix:**

- All HTTP calls → use shared `apiFetch`
- All WebSocket logic → use `window.location.host` (not hardcoded ports)
- No custom fetch wrappers unless absolutely necessary

**Why it works:** One source of truth. When the API changes, update one helper instead of hunting down every custom implementation.

### Lesson 6: Kill Your Strays

**The problem:** A leftover Vite dev server intercepted traffic on the production port.

**The fix:** Before starting servers, check for conflicts:

```bash
lsof -i :3000
```

**Why it works:** You can't bind to a port that's already in use. Better to catch it before starting than debug mysterious proxy issues.

### Lesson 7: Orchestrators Delegate, Workers Execute

**The problem:** Main agent (Opus) spent 10+ minutes doing implementation work instead of delegating to sub-agents.

**The fix:**

- Opus → orchestration, decision-making, communication with human
- Sonnet/Codex → implementation, debugging, grunt work
- Never tie up the main agent with tasks that can be delegated

**Why it works:** Opus costs 15x more than Sonnet. Don't waste it on implementation work.

---

## Process Changes Implemented

### 1. Updated CONTRIBUTING.md

Added **Development Workflow** section with:

- Branch Merge Protocol (one at a time, smoke test between)
- Pre-Merge Checklist (types, builds, hardcoded values, CSP/CORS, hooks)
- Environment Rules (don't change PORT, include production origins, allow WebSocket in all modes)
- Testing Requirements (runtime verification, not just builds)
- Common Integration Failures (what to watch for)

### 2. Mandatory Smoke Test Checklist

Before declaring a branch "ready to merge":

- [ ] Health check returns 200
- [ ] Auth flow works
- [ ] Task CRUD works
- [ ] WebSocket real-time updates work
- [ ] No stray processes (`lsof -i :3000`)
- [ ] Tested in `NODE_ENV=production`

### 3. Environment Variable Audit

Action item: Audit codebase for hardcoded values and replace with env vars:

- [ ] Server port
- [ ] API base URL
- [ ] WebSocket URL
- [ ] Agent callback URLs
- [ ] Timeouts and limits
- [ ] CORS origins
- [ ] CSP directives

### 4. Shared Helper Enforcement

Action item: Verify all HTTP and WebSocket code uses shared helpers:

- [ ] Replace custom `fetchApi` in auth hook with shared `apiFetch`
- [ ] Replace hardcoded ports in WebSocket hooks with `window.location.host`
- [ ] Document shared helpers in CONTRIBUTING.md

---

## Checklist for Future Parallel Development

Use this when working on multiple feature branches simultaneously:

### During Development

- [ ] Each branch exports new types in barrel files
- [ ] No hardcoded ports/URLs in application code
- [ ] All configurable values use env vars
- [ ] Changes to CSP/CORS work in both dev and production

### Before Merging

- [ ] Merge **one branch at a time** (never batch-merge)
- [ ] Run `pnpm build` after each merge
- [ ] Run smoke tests after each merge
- [ ] Check for stray processes (`lsof -i :3000`)
- [ ] Test in `NODE_ENV=production`

### During Review

- [ ] Code review passed (syntax, types, lint)
- [ ] **Runtime verification passed** (smoke tests)
- [ ] No hardcoded values introduced
- [ ] Shared helpers used (not custom implementations)

### After All Merges

- [ ] Full regression test
- [ ] Documentation updated
- [ ] Lessons learned captured

---

## Conclusion

Parallel development is powerful but dangerous. The 5-branch merge disaster happened because we optimized for speed (batch-merging) instead of safety (sequential merging with testing).

**The fix is simple:** Slow down between merges. One branch, one build, one smoke test. Repeat.

**The lesson is timeless:** Fast feedback beats batch processing. Catch integration issues early, when you know which branch caused them.

**The cost of rushing:** 1 hour of debugging, 10 root causes, this post-mortem document, and updated process docs.

**Don't let it happen again.**

## Addendum: One Agent Per File (11:00 AM)

### What Happened

After merging the 5 feature branches, we had 4+ agents (TARS, CASE, R2-D2, VERITAS) all editing `SquadChatPanel.tsx` concurrently with separate fixes. Each change was correct in isolation but they stomped on each other, breaking the entire component.

### Root Cause

Same principle as the parallel branch merges — serialized access to shared resources is mandatory, not optional. This applies at the file level, not just the branch level.

### Rule

**One agent per file. One agent per task. Period.**

- Assign ownership explicitly
- Agent completes and confirms before anyone else touches the file
- If a task spans multiple files, one agent owns the entire task

### Prevention

Added to CONTRIBUTING.md as a hard constraint alongside the sequential merge protocol.
