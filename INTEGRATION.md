# Integration Guide — User Feedback Loop (#182)

This file describes exactly what needs to be added to each protected integration file.
Do NOT modify these files directly — Brad will merge them manually.

---

## 1. `shared/src/types/index.ts`

Add a re-export for the new feedback types (near the existing evaluation types export):

```ts
export * from './feedback.types.js';
```

---

## 2. `server/src/routes/v1/index.ts`

### Import (add alongside the `scoringRoutes` import)

```ts
import { feedbackRoutes } from '../feedback.js';
```

### Route registration (add after the `scoring` line)

```ts
v1Router.use('/feedback', feedbackRoutes);
```

---

## 3. `web/src/lib/api/index.ts`

### Import (add alongside the `scoringApi` import)

```ts
import { feedbackApi } from './feedback';
```

### Add to the `api` object (alongside `scoring: scoringApi`)

```ts
feedback: feedbackApi,
```

---

## 4. `web/src/App.tsx` (optional — if you want a dedicated route)

If you want the FeedbackPanel reachable via a standalone route:

```tsx
import { FeedbackPanel } from '@/components/feedback/FeedbackPanel';

// Inside your <Routes>:
<Route path="/feedback" element={<FeedbackPanel />} />
```

---

## 5. `web/src/contexts/ViewContext.tsx` (optional)

If your view-context lists available views, add:

```ts
'feedback'
```

to the views union / array so the Header / CommandPalette can navigate to it.

---

## 6. `web/src/components/layout/Header.tsx` (optional)

Add a nav entry for feedback using the existing pattern, e.g.:

```tsx
import { MessageSquare } from 'lucide-react';
// ...
{ label: 'Feedback', view: 'feedback', icon: MessageSquare }
```

---

## 7. `web/src/components/layout/CommandPalette.tsx` (optional)

If the palette is driven by the view list from ViewContext, no change needed.
Otherwise add:

```ts
{ id: 'feedback', label: 'Feedback', description: 'View and submit user feedback' }
```

---

## Storage

The feedback service stores data in `server/storage/feedback/*.json` (one file per record).
The directory is created automatically on first write — no migration needed.
