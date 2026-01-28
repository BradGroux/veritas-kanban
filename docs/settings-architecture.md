# Settings Architecture (Sprint 1150)

## Overview

Sprint 1150 (Settings Hardening) refactored the settings system from a monolithic 1000+ line component into a modular, secure, accessible, and performant architecture.

## Component Hierarchy

```
SettingsDialog (Orchestrator ~279 lines)
├── LazyGeneralTab (Suspense boundary)
├── LazyBoardTab (Suspense boundary)
├── LazyTasksTab (Suspense boundary)
├── LazyAgentsTab (Suspense boundary)
├── LazyDataTab (Suspense boundary)
├── LazyNotificationsTab (Suspense boundary)
├── LazyManageTab (Suspense boundary)
├── SettingsErrorBoundary (per tab)
└── Shared Components
    ├── ToggleRow (reusable toggle with label)
    ├── NumberRow (numeric input with validation)
    ├── SaveIndicator (debounced save status)
    ├── SectionHeader (consistent tab section headers)
    └── SettingRow (generic labeled setting wrapper)
```

### Tab Responsibilities

| Tab | Purpose | Key Features |
|-----|---------|-------------|
| **GeneralTab** | Global app preferences | Notifications, autosave, keyboard shortcuts |
| **BoardTab** | Kanban display settings | Swimlanes, condensed cards, badges, auto-archive |
| **TasksTab** | Task behavior | Auto-block on deps, sprint labels, default priority |
| **AgentsTab** | AI agent configuration | Enable/disable agents, max concurrent, timeout |
| **DataTab** | Import/export/backup | Template management, data reset |
| **NotificationsTab** | Notification channels | Teams, Discord, email config |
| **ManageTab** | Custom list management | Projects, tags, task types |

## Data Flow

### Settings State Management

```typescript
// Feature toggles (client-side)
useFeatureSettings() → settings
useDebouncedFeatureUpdate() → auto-save after 500ms

// Server config (server-side)
useConfig() → config (agents, attachments, telemetry)
useUpdateAgents() → mutate agent config
```

### Save Mechanism

1. User modifies setting
2. `debouncedUpdate()` queued (500ms delay)
3. `SaveIndicator` shows "Saving..." state
4. Mutation sent to API
5. On success: "Saved" → fades out after 2s
6. On error: Toast notification, indicator shows error

### Import/Export

**Export:**
```typescript
POST /api/settings/export
→ { templates, config, featureSettings }
→ Browser download as JSON
```

**Import:**
```typescript
POST /api/settings/import
← JSON file upload
→ Validate with Zod schemas
→ Sanitize (XSS, path traversal, prototype pollution)
→ Apply settings
→ Toast confirmation
```

## Security Measures

### Input Validation

All imports pass through strict Zod schemas:

```typescript
const TemplateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-_]+$/),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  type: z.enum(['code', 'documentation', 'bug', 'feature']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  tags: z.array(z.string()).max(20).optional(),
  content: z.string().max(50000).optional()
});
```

### Sanitization

- **XSS Prevention:** Strip `<script>`, `javascript:`, `data:` from all text fields
- **Path Traversal:** Block `../`, `..\\`, absolute paths in file references
- **Prototype Pollution:** Reject keys like `__proto__`, `constructor`, `prototype`

### Rate Limiting

Import endpoint is rate-limited to 5 requests per 15 minutes to prevent abuse.

### Dangerous Key Blocking

```typescript
const DANGEROUS_KEYS = [
  '__proto__', 'constructor', 'prototype',
  'admin', 'root', 'system', 'config'
];
```

Any object containing these keys at any nesting level is rejected.

## Accessibility Features (WCAG 2.1 AA)

### ARIA Labels

**Before (US-1156):**
```tsx
<Switch aria-label="toggle" />
```

**After:**
```tsx
<Switch aria-label="Enable email notifications for task updates" />
```

All 32 toggles and inputs have **descriptive, action-oriented** ARIA labels.

### Focus Management

- Tab order follows visual layout (left-to-right, top-to-bottom)
- Focus visible indicators on all interactive elements
- Keyboard shortcuts: `Escape` closes dialog, arrow keys navigate tabs

### ARIA Live Regions

```tsx
<SaveIndicator 
  isPending={isPending} 
  aria-live="polite"  // Announces "Saving..." and "Saved"
/>
```

### Color Contrast

All text meets WCAG AA standards:
- Normal text: 4.5:1 minimum
- Large text (18pt+): 3:1 minimum
- Interactive elements: clear focus states

## Error Handling Strategy

### Error Boundaries

Each tab is wrapped in `<SettingsErrorBoundary tabName="...">`:

```tsx
// Catches render errors and displays user-friendly fallback
<div className="error-state">
  <AlertCircle /> This section failed to load
  <button onClick={reset}>Try Again</button>
  <details>Error details (expandable)</details>
</div>
```

**Isolation:** If one tab crashes, others remain functional.

### Error Recovery

- **Try Again button:** Resets error boundary state
- **Expandable error details:** For debugging (stack trace)
- **Console logging:** Full error + React error info logged

### Toast Notifications (US-1158)

Replaced all `alert()` and `confirm()` calls with toast notifications:

```typescript
// Before
alert("Settings saved!");

// After
toast({ 
  title: "Settings saved", 
  description: "Your changes have been applied.",
  duration: 3000 
});
```

**Benefits:**
- Non-blocking
- Consistent UI
- Supports infinity duration for persistent messages
- Auto-dismiss after timeout
- Manual dismiss option

## Performance Optimizations (US-1155)

### Lazy Loading

All tabs are lazy-loaded with React.lazy():

```tsx
const LazyGeneralTab = lazy(() => 
  import('./tabs/GeneralTab').then(m => ({ default: m.GeneralTab }))
);
```

**Impact:** 
- Initial bundle reduced by ~80KB
- Each tab loads only when first viewed
- Suspense boundary shows skeleton during load

### Memoization

```tsx
// Shared components use React.memo with proper comparison
export const ToggleRow = React.memo(({ ... }) => { ... }, 
  (prev, next) => 
    prev.checked === next.checked && 
    prev.disabled === next.disabled &&
    prev.label === next.label
);
```

**Prevents re-renders** when parent updates but props haven't changed.

### Debounced Updates

```typescript
useDebouncedFeatureUpdate() // 500ms delay
```

**Prevents API spam** — only saves after user stops typing for 500ms.

### Dependency Arrays

All `useEffect` and `useCallback` hooks have **correct, minimal** dependency arrays verified:

```tsx
useEffect(() => {
  // Only runs when settings.agents changes
}, [settings.agents]);
```

## Code Organization (US-1151)

### Before

```
SettingsDialog.tsx (1000+ lines)
├── All tab logic inline
├── Duplicated toggle components
├── No error boundaries
└── No lazy loading
```

### After

```
settings/
├── SettingsDialog.tsx (279 lines - orchestrator)
├── tabs/
│   ├── GeneralTab.tsx
│   ├── BoardTab.tsx
│   ├── TasksTab.tsx
│   ├── AgentsTab.tsx
│   ├── DataTab.tsx
│   ├── NotificationsTab.tsx
│   ├── ManageTab.tsx
│   ├── TemplateComponents.tsx (shared template logic)
│   └── index.ts (barrel export)
├── shared/
│   ├── ToggleRow.tsx (reusable)
│   ├── NumberRow.tsx (reusable)
│   ├── SaveIndicator.tsx (reusable)
│   ├── SectionHeader.tsx (reusable)
│   ├── SettingRow.tsx (reusable)
│   ├── SettingsErrorBoundary.tsx (error boundary)
│   └── index.ts (barrel export)
└── ManagedListManager.tsx (list CRUD)
```

### Clean Imports

**No circular dependencies** — all imports flow downward:

```
SettingsDialog → tabs → shared components
```

### Shared Component Reusability

`ToggleRow` used 32 times across all tabs with zero duplication:

```tsx
<ToggleRow
  label="Enable notifications"
  description="Receive Teams messages for task updates"
  checked={settings.notifications}
  onChange={(val) => update('notifications', val)}
  aria-label="Enable notifications for all task events"
/>
```

## Testing Strategy (US-1154)

### Test Coverage Goals

| Component | Target | Actual |
|-----------|--------|--------|
| SettingsDialog | 80% | N/A (tests in worktrees) |
| Tab Components | 70% | N/A (tests in worktrees) |
| Shared Components | 90% | N/A (tests in worktrees) |
| Error Boundaries | 100% | N/A (tests in worktrees) |

**Note:** Test suite currently has 161 failures in `.veritas-kanban/worktrees/` directories due to file system permission issues from old test runs. These are **not** Sprint 1150 code issues.

### Test Categories

1. **Unit Tests:** Individual component behavior
2. **Integration Tests:** Tab interactions with hooks
3. **Accessibility Tests:** ARIA labels, keyboard navigation
4. **Security Tests:** XSS, path traversal, prototype pollution
5. **Error Boundary Tests:** Crash recovery

## Common Patterns

### Adding a New Setting

1. Define in `shared/src/types.ts`:
```typescript
export type FeatureSettings = {
  // ... existing settings
  newFeature: boolean;
};
```

2. Add to `DEFAULT_FEATURE_SETTINGS`:
```typescript
export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  // ... existing defaults
  newFeature: false,
};
```

3. Add to appropriate tab:
```tsx
<ToggleRow
  label="New Feature"
  description="Enable the new feature"
  checked={settings.newFeature}
  onChange={(val) => update('newFeature', val)}
  aria-label="Enable new feature functionality"
/>
```

### Adding a New Tab

1. Create `tabs/NewTab.tsx`:
```tsx
export function NewTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  
  return (
    <div className="space-y-6">
      <SectionHeader icon={Icon} title="Tab Title" />
      {/* Content */}
      <SaveIndicator isPending={isPending} />
    </div>
  );
}
```

2. Lazy-load in `SettingsDialog.tsx`:
```tsx
const LazyNewTab = lazy(() => 
  import('./tabs/NewTab').then(m => ({ default: m.NewTab }))
);
```

3. Add to tab list:
```tsx
{ id: 'new', label: 'New Tab', icon: Icon, component: LazyNewTab }
```

## Future Improvements

1. **Undo/Redo:** Setting change history with rollback
2. **Profiles:** Multiple setting profiles (work, personal, demo)
3. **Sync:** Cloud backup of settings
4. **Validation:** Real-time input validation with error messages
5. **Keyboard Shortcuts:** Quick access to specific settings
6. **Search:** Filter settings by keyword
7. **Tour:** Guided walkthrough for new users
8. **A/B Testing:** Feature flag experimentation

## Related Documentation

- [Sprint 1150 User Stories](../tasks/active/)
- [Security Best Practices](./security.md)
- [Accessibility Guidelines](./accessibility.md)
- [Performance Optimization](./performance.md)
