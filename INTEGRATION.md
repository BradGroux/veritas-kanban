# Prompt Template Registry — Integration Points

This document outlines the manual integration steps required to complete feature #184. These files must be merged manually to avoid type conflicts and maintain consistency with existing code patterns.

## 1. `shared/src/types/index.ts`

**Action:** Export the new prompt registry types

Add these lines to the exports:
```typescript
// Prompt Registry Types
export type {
  PromptTemplate,
  PromptVersion,
  PromptUsage,
  PromptStats,
  PromptCategory,
  CreatePromptTemplateInput,
  UpdatePromptTemplateInput,
  RenderPreviewRequest,
  RenderPreviewResponse,
} from './prompt-registry.types.js';
```

**Location:** Add to the end of the file, after other type exports.

## 2. `server/src/routes/v1/index.ts`

**Action:** Register the prompt registry routes

Add these lines in the route registration section (typically where other routes are imported and used):

```typescript
// Import
import promptRegistryRouter from '../prompt-registry.js';

// Register route (add with other route registrations)
app.use('/api/prompt-registry', promptRegistryRouter);
```

**Location:** Find where other routes like `templates`, `tasks`, `chat` are registered. Add the prompt registry route in the same pattern.

**Expected pattern:**
```typescript
app.use('/api/templates', templateRouter);
app.use('/api/prompt-registry', promptRegistryRouter);  // <-- Add this line
app.use('/api/tasks', taskRouter);
```

## 3. `web/src/App.tsx`

**Action:** Add route to prompt registry component

Add route registration in the React Router configuration:

```typescript
// Import
import PromptRegistry from './components/prompts/PromptRegistry.js';

// In route definition (typically in a <Routes> element)
<Route path="/prompts" element={<PromptRegistry />} />
```

**Location:** Find where other routes are defined (e.g., `/templates`, `/tasks`, etc.) and add the prompts route alongside them.

## 4. `web/src/contexts/ViewContext.tsx`

**Action:** Add prompt registry to navigation context (optional but recommended)

If the app uses a navigation context to track available views, add:

```typescript
// In the view type definition
export type ViewType = '...' | 'prompts';

// In default views or navigation menu
{
  id: 'prompts',
  label: 'Prompt Templates',
  icon: 'prompt-icon', // Use appropriate icon
  path: '/prompts'
}
```

**Location:** Find where view definitions are configured.

## 5. `web/src/components/layout/Header.tsx`

**Action:** Add navigation link to prompt registry (optional)

Add a link to the prompt registry in the navigation bar:

```tsx
<NavLink to="/prompts" className={navLinkClass}>
  <Icon name="prompt" /> Prompts
</NavLink>
```

**Location:** In the navigation menu section of the header.

## 6. `web/src/components/layout/CommandPalette.tsx`

**Action:** Add command palette entry (optional but useful)

Add a command for quick navigation to prompts:

```typescript
{
  id: 'prompt-registry',
  label: 'Open Prompt Registry',
  description: 'Manage and view prompt templates',
  icon: 'prompt',
  action: () => navigate('/prompts'),
  keywords: ['prompt', 'template', 'registry', 'ai'],
}
```

**Location:** In the command definitions array.

## Implementation Order

1. **First:** Update `shared/src/types/index.ts` (enables TypeScript compilation of dependent files)
2. **Second:** Update `server/src/routes/v1/index.ts` (enables server API)
3. **Third:** Update `web/src/App.tsx` (enables web routing)
4. **Fourth:** Update navigation contexts/components (optional but recommended)
5. **Fifth:** Run builds and tests

## Verification Checklist

After manual integration:

- [ ] `pnpm --filter @veritas-kanban/shared build` passes without errors
- [ ] Server starts without route registration errors
- [ ] `/api/prompt-registry` endpoints respond (test: `GET /api/prompt-registry`)
- [ ] Web app navigates to `/prompts` without 404
- [ ] PromptRegistry component renders without console errors
- [ ] React Query hooks initialize correctly
- [ ] Type inference works in IDE (no red squiggles on API calls)

## Files Created (Do Not Modify)

These files are complete and require no further changes:

1. ✅ `shared/src/types/prompt-registry.types.ts` — Core types
2. ✅ `server/src/services/prompt-registry-service.ts` — Service layer
3. ✅ `server/src/routes/prompt-registry.ts` — REST routes
4. ✅ `web/src/lib/api/prompt-registry.ts` — API client
5. ✅ `web/src/hooks/usePromptRegistry.ts` — React Query hooks
6. ✅ `web/src/components/prompts/PromptRegistry.tsx` — Main UI component
7. ✅ `web/src/components/prompts/PromptRegistry.module.css` — Component styles

## Notes

- All files follow existing code patterns (zod validation, gray-matter for storage, React Query hooks)
- No external dependencies added beyond what's already in use
- Storage uses file-based approach (consistent with template-service)
- Endpoints follow REST conventions
- Component uses React hooks and follows established patterns

## Questions?

Refer to reference implementations:
- **Template pattern:** `server/src/services/template-service.ts`
- **Route pattern:** `server/src/routes/templates.ts`
- **API client pattern:** `web/src/lib/api/entities.ts`
- **React hooks pattern:** `web/src/hooks/` directory
