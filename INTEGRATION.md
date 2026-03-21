# Integration Guide — Issue #183: Draggable & Resizable Dashboard Widget Grid

## What Was Created

| File | Purpose |
|------|---------|
| `web/src/hooks/useDashboardLayout.ts` | localStorage persistence + versioning for widget layouts |
| `web/src/components/dashboard/WidgetWrapper.tsx` | Wrapper with drag handle, title, "View all →" link |
| `web/src/components/dashboard/WidgetGrid.tsx` | `<ResponsiveGridLayout>` component using react-grid-layout |
| `web/src/components/dashboard/DashboardPage.tsx` | Full dashboard that uses WidgetGrid instead of fixed layout |

## Changes Required in Existing Files

### 1. `web/src/components/board/KanbanBoard.tsx`

**Current code (around line 30):**
```tsx
const Dashboard = lazy(() =>
  import('@/components/dashboard/Dashboard').then((mod) => ({
    default: mod.Dashboard,
  }))
);
```

**Change to:**
```tsx
const Dashboard = lazy(() =>
  import('@/components/dashboard/DashboardPage').then((mod) => ({
    default: mod.DashboardPage,
  }))
);
```

**Also update the usage site (around line 315):**
```tsx
// Before:
<Dashboard />

// After (no change needed if you update the import above — the variable is still called Dashboard)
<Dashboard />
```

That's the only required change — just swap the lazy import source from `Dashboard` → `DashboardPage`.

---

### 2. `web/src/components/dashboard/index.ts` (optional)

Add an export for the new components so they're accessible:
```ts
export { DashboardPage } from './DashboardPage';
export { WidgetGrid, type GridWidgetConfig } from './WidgetGrid';
export { WidgetWrapper } from './WidgetWrapper';
```

---

## No Changes Needed In

- `web/src/App.tsx` — ✅ unchanged
- `web/src/contexts/ViewContext.tsx` — ✅ unchanged
- `web/src/components/layout/Header.tsx` — ✅ unchanged
- `web/src/components/layout/CommandPalette.tsx` — ✅ unchanged

## Notes

- **CSS**: react-grid-layout CSS is imported locally inside `WidgetGrid.tsx`, not globally.
- **Mobile**: Drag handle and resize handle are hidden via CSS media query for screens < 768px.
- **Layout versioning**: Stored at `veritas-kanban-widget-layout-version` in localStorage. Bump `LAYOUT_VERSION` in `useDashboardLayout.ts` when adding new widgets.
- **Backward compatibility**: `Dashboard.tsx` (the original fixed-grid dashboard) is unchanged. `DashboardPage.tsx` is a new file that replaces it in `KanbanBoard.tsx`.
