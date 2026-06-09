# Click-through Tutorials Roadmap

## For future VERITAS

This roadmap tracks issue #693: product-native click-through tutorials for Veritas Kanban. The goal is not a one-off onboarding modal. The goal is a reusable guided-tour system that works in the macOS desktop app and web/PWA surfaces, respects product modes, remains keyboard/screen-reader accessible, and can be extended as v5 features grow.

## Goals

- Teach the first useful workflow in under five minutes.
- Reduce “where do I click next?” friction for new desktop and web users.
- Support Board Only, Team/Remote, and Advanced product modes without showing irrelevant agent/admin steps.
- Use real UI surfaces instead of screenshots where possible.
- Keep tutorials resumable, skippable, resettable, and safe for demo data.
- Give support/docs a stable tour ID vocabulary for screenshots, videos, and bug reports.

## Non-goals

- Do not block app access behind mandatory training.
- Do not build a marketing carousel.
- Do not rely on brittle DOM selectors with no product-owned anchor IDs.
- Do not teach every feature in one mega-tour.
- Do not expose admin/security steps to users who lack permission.

## Recommended implementation shape

### 1. Tour registry

Add a registry that describes tours as data:

```ts
interface GuidedTourDefinition {
  id: string;
  title: string;
  description: string;
  productModes: ProductMode[];
  requiredPermissions?: string[];
  entryCommand?: string;
  steps: GuidedTourStep[];
}

interface GuidedTourStep {
  id: string;
  title: string;
  body: string;
  target?: string; // data-tour-id value
  placement?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  route?: string;
  actionHint?: string;
  completion?: 'next-click' | 'target-click' | 'route-visible' | 'manual';
}
```

Use `data-tour-id` anchors on stable product elements instead of CSS selectors. Missing anchors should fail gracefully by showing a centered step with a “Go there” action when possible.

### 2. Tour runtime

Add a small guided-tour runtime responsible for:

- tour state: not started, active, completed, dismissed;
- current tour/step persistence in local storage initially;
- route-aware step navigation;
- focus trap and escape handling;
- reduced-motion support;
- spotlight/overlay rendering;
- analytics event hooks, if enabled;
- reset/replay from Help/Command Palette.

A lightweight in-house runtime is preferable to adopting a heavy tour library unless we need complex positioning. If a library is considered later, evaluate bundle cost, accessibility, keyboard handling, React 19 compatibility, and Mantine integration first.

### 3. Tour launcher surfaces

Expose tours from:

- desktop menu command: Help → Tutorials / Setup & Diagnostics adjacent;
- Command Palette: “Start board basics tour,” “Start agent workflow tour,” etc.;
- first-run desktop onboarding final step;
- empty states: board, templates, agents, workflows;
- Help/keyboard shortcut dialog.

### 4. Product-mode awareness

Tours should filter by current `features.productMode.selectedMode`:

| Mode        | Default tours                                                   |
| ----------- | --------------------------------------------------------------- |
| Board Only  | Board basics, task detail, search/filter, backup/export         |
| Team/Remote | Board basics, comments/activity, access model, notifications    |
| Advanced    | Board basics, agents, workflows, evidence/timeline, maintenance |

Existing users default to Advanced, but tutorials should not assume the user wants every advanced surface.

## Initial tour set

### Tour 1 — Board basics

Audience: everyone.

Steps:

1. Board columns and task cards.
2. Create a task.
3. Open task detail.
4. Move status.
5. Add comment/checklist-style progress.
6. Use search/filter.
7. Finish with “replay from Help anytime.”

### Tour 2 — From task to agent work

Audience: Advanced mode; hidden unless agents are enabled or user has agent permissions.

Steps:

1. Open a task.
2. Add enough context for an agent.
3. Select/run an agent or workflow.
4. Watch run timeline/status.
5. Review evidence/output.
6. Mark done with validation notes.

### Tour 3 — Desktop first-run safety

Audience: macOS desktop.

Steps:

1. Local server/profile location.
2. Recovery key/password reminder.
3. Settings → Maintenance health.
4. Backup/import/export.
5. Update channel/status.

### Tour 4 — Workflows and templates

Audience: Advanced mode.

Steps:

1. Templates vs workflows.
2. Apply a task template.
3. Open workflow authoring.
4. Run a sample workflow.
5. Inspect run/evidence timeline.

### Tour 5 — Admin/security essentials

Audience: owner/admin only.

Steps:

1. Product modes.
2. Agent/provider settings.
3. Tool policies and enforcement.
4. Shared resources/skills.
5. Maintenance center/debug bundle.

## Accessibility requirements

- Every tour action must be keyboard reachable.
- `Esc` dismisses the current tour with confirmation or an undo snackbar.
- Focus returns to the launching control after exit.
- Screen readers receive step title, body, position, and target context.
- Spotlight/overlay cannot be the only instruction; text must be sufficient.
- Respect `prefers-reduced-motion`.
- Maintain color contrast in dark and light themes.

## Persistence and privacy

Initial persistence can be local-only:

```json
{
  "guidedTours": {
    "completed": { "board-basics": "2026-06-08T00:00:00.000Z" },
    "dismissed": { "agent-workflow": "2026-06-08T00:00:00.000Z" },
    "active": null
  }
}
```

Do not sync tutorial progress to a remote server unless there is a clear multi-device UX need and the user/account model can explain it.

## Implementation backlog

1. **Add tour anchor IDs** to board, task card, create task, task detail, search/filter, settings, maintenance, agents, workflows, and command palette surfaces.
2. **Create guided-tour registry** with product-mode and permission filters.
3. **Create guided-tour runtime/provider** with overlay, focus handling, persistence, and route-aware navigation.
4. **Add Command Palette + Help launchers** for available tours.
5. **Wire desktop menu command** to open the tutorial launcher.
6. **Implement Board basics tour** and tests first.
7. **Implement Desktop first-run safety tour** integrated with existing desktop onboarding.
8. **Implement Advanced agent/workflow tours** after anchor/runtime stability.
9. **Add Playwright or component tests** for launch, next/back, skip, missing anchor fallback, keyboard escape, and product-mode filtering.
10. **Update docs/screenshots/video script** once the runtime is stable.

## Suggested task split

- `guided-tour-anchors`: add `data-tour-id` anchors and tests around critical surfaces.
- `guided-tour-runtime`: provider, overlay, persistence, keyboard/a11y behavior.
- `guided-tour-launchers`: Command Palette, Help dialog, desktop menu command.
- `tour-board-basics`: first product tour, docs, and tests.
- `tour-desktop-safety`: desktop setup/maintenance/update tour.
- `tour-agent-workflow`: advanced task-to-agent tour.

## Acceptance criteria for #693

- A checked-in roadmap/design doc exists.
- The issue has a concrete implementation sequence.
- Follow-up issues/tasks can be created without rediscovering product constraints.
- The first implementation PR can start with Board basics rather than architecture debate.
