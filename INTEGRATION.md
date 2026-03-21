# Integration Guide — Global System Health Status Bar (#185)

## What was built

| File | Purpose |
|------|---------|
| `shared/src/types/system-health.types.ts` | `HealthLevel`, `HealthStatus`, `HealthSignal`, and signal types shared across server + web |
| `server/src/services/system-health-service.ts` | `SystemHealthService` class + `getSystemHealthService()` singleton — aggregates telemetry into `HealthStatus` |
| `web/src/lib/api/system-health.ts` | `systemHealthApi.getStatus()` — typed fetch wrapper for `GET /api/v1/system/health` |
| `web/src/hooks/useSystemHealth.ts` | React Query hook; polls every 30 s (60 s when WS disconnected) |
| `web/src/components/health/SystemHealthBar.tsx` | The persistent UI component — thin strip + expandable detail panel |
| `web/src/components/layout/SystemHealthBar.tsx` | Already present on `main` — thin strip implementation using inline types |

> **Note:** `web/src/components/health/SystemHealthBar.tsx` is the canonical new implementation
> using the shared `HealthLevel` type and the spec-required icons (`ShieldCheck`, `AlertCircle`).
> The `layout/SystemHealthBar.tsx` version that already existed on `main` is functionally
> equivalent; Brad should pick one when merging.

---

## App.tsx integration

Place `<SystemHealthBar />` **directly below `<Header />`**, before `<main>`:

```tsx
// web/src/App.tsx  (excerpt — Brad will merge manually)
import { SystemHealthBar } from './components/health/SystemHealthBar';
// or keep the existing import from layout/:
// import { SystemHealthBar } from './components/layout/SystemHealthBar';

// Inside the JSX tree:
<div className="min-h-screen bg-background">
  <SkipToContent />
  <Header />
  <SystemHealthBar />          {/* ← insert here */}
  <main id="main-content" className="mx-auto px-14 py-6" tabIndex={-1}>
    <ErrorBoundary level="section">
      <MainContent />
    </ErrorBoundary>
  </main>
  <Toaster />
  <CommandPalette />
  <FloatingChat />
</div>
```

`App.tsx` on `main` already has this import and placement — no action needed unless you
chose the `components/health/` version.

---

## Server route

The existing `server/src/routes/system-health.ts` already handles `GET /api/v1/system/health`
and is registered in `server/src/routes/v1/index.ts`.  No changes needed.

Optionally, the route can be refactored to delegate to `getSystemHealthService()` to remove
code duplication, but this is not required for the feature to work.

---

## Shared type export

`shared/src/types.ts` was updated to re-export from `system-health.types.ts`.
This makes `HealthLevel`, `HealthStatus`, etc. available via `@veritas-kanban/shared`.

The forbidden file `shared/src/types/index.ts` was **not modified**.

---

## Polling behaviour

| Condition | Interval |
|-----------|----------|
| WebSocket connected | 30 s |
| WebSocket disconnected | 60 s |
| `staleTime` | 15 s |

Filters (`projectId`, `agentId`) are accepted by `SystemHealthService.getStatus()` but are
not yet wired into the route query-string — reserved for a future scoped-health iteration.
