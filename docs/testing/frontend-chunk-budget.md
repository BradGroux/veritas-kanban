# Frontend Chunk Budget

Veritas uses Vite's production chunk warning as the first-line bundle guard.

## Budget

- Individual minified JavaScript chunks should stay under 400 KiB.
- `web/vite.config.ts` sets `build.chunkSizeWarningLimit` to `400`.
- Do not raise this limit without documenting the specific chunk, why it is not avoidable, and what would be required to reduce it.

## Expected Large Chunks

These chunks are expected to be among the largest after the v5 route split:

- Chart chunks generated from lazy chart modules such as `TrendsCharts`, `DriftMonitor`, or `ScoreExplorer`. They should be loaded by chart-heavy surfaces, not by the initial board route.
- `vendor-mantine`: Mantine UI runtime. Shared by the primary app shell and dialogs.
- `TaskDetailPanel`: Task drawer shell and the always-present work/details tab surfaces.
- `index`: Authenticated app shell, board, header, providers, and core routing.

## Loading Rules

- Board rendering must not statically import dashboard/chart-heavy code.
- Dashboard trend charts are deferred until the chart section approaches the viewport.
- Settings dialog tabs stay lazy-loaded by active tab.
- Workflow dashboard and scoring explorer panels stay lazy-loaded behind their explicit UI entry points.

## Verification

For bundle work, use:

```bash
pnpm --filter @veritas-kanban/web build
```

Then confirm the build has no avoidable chunk-size warning and smoke these rendered paths:

- board load
- dashboard render and deferred trends section
- settings dialog
- task detail drawer
