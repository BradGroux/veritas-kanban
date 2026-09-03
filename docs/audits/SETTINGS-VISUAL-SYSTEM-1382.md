# Settings visual-system verification (#1382)

Date: September 3, 2026.

## Scope and result

All 20 Settings destinations use the shared page, section, subgroup, action, and semantic-state vocabulary. Advanced navigation badges and compact-option suffixes are removed; Core remains first. Transfer and Danger Zone stay separate, with a compact actions menu when the sidebar is hidden. Consecutive arrow-key navigation retains tab focus.

Native screenshot inspection found a sortable-row layout regression in Manage that DOM-only tests missed. Mantine Paper's display rule overrode the Tailwind flex/grid utility. Scoped Settings layout rules now preserve those layouts, with browser and packaged-app regression checks.

## Verification environment

The candidate is the unsigned arm64 packaged Electron 44.1.1 application built from this change, not a browser impersonating desktop. Playwright launched the actual application executable and confirmed `app.isPackaged === true`. It used an isolated synthetic profile on port 3002; the installed 6.1.6 app and its user data were not replaced.

Fixed screenshots use a 1360 × 900 native window (2720 × 1800 Retina images). All destinations were opened in both themes. All 20 dark views and the nine required light views (General, Agents, Notifications, Workspaces, Scheduler, Tool Policies, Enforcement, Maintenance, Manage) were visually inspected. Multi-user light was also checked after the layout correction. Captures show the initial viewport; they are not a claim that every possible data state or nested modal was exercised.

At the shipped 1180 × 760 minimum, 20px root text passed action/pill clipping checks across all 20 destinations. General → Board → Tasks passed consecutive keyboard focus checks. A diagnostic-only minimum-size override allowed a 620 × 650 check of the compact selector and Export/Import/Reset actions; that smaller size is not the shipped native minimum.

## Evidence matrix

| Destination      | Dark                                                     | Light                                                      |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| General          | [Dark](evidence/settings-1382/general-dark.png)          | [Light](evidence/settings-1382/general-light.png)          |
| Board            | [Dark](evidence/settings-1382/board-dark.png)            | [Light](evidence/settings-1382/board-light.png)            |
| Tasks            | [Dark](evidence/settings-1382/tasks-dark.png)            | [Light](evidence/settings-1382/tasks-light.png)            |
| Agents           | [Dark](evidence/settings-1382/agents-dark.png)           | [Light](evidence/settings-1382/agents-light.png)           |
| Data             | [Dark](evidence/settings-1382/data-dark.png)             | [Light](evidence/settings-1382/data-light.png)             |
| Notifications    | [Dark](evidence/settings-1382/notifications-dark.png)    | [Light](evidence/settings-1382/notifications-light.png)    |
| Multi-user       | [Dark](evidence/settings-1382/multi-user-dark.png)       | [Light](evidence/settings-1382/multi-user-light.png)       |
| Workspaces       | [Dark](evidence/settings-1382/workspaces-dark.png)       | [Light](evidence/settings-1382/workspaces-light.png)       |
| Delegation       | [Dark](evidence/settings-1382/delegation-dark.png)       | [Light](evidence/settings-1382/delegation-light.png)       |
| Scheduler        | [Dark](evidence/settings-1382/scheduler-dark.png)        | [Light](evidence/settings-1382/scheduler-light.png)        |
| Queues           | [Dark](evidence/settings-1382/queues-dark.png)           | [Light](evidence/settings-1382/queues-light.png)           |
| Reflections      | [Dark](evidence/settings-1382/reflections-dark.png)      | [Light](evidence/settings-1382/reflections-light.png)      |
| Trackers         | [Dark](evidence/settings-1382/trackers-dark.png)         | [Light](evidence/settings-1382/trackers-light.png)         |
| Security         | [Dark](evidence/settings-1382/security-dark.png)         | [Light](evidence/settings-1382/security-light.png)         |
| Tool Policies    | [Dark](evidence/settings-1382/tool-policies-dark.png)    | [Light](evidence/settings-1382/tool-policies-light.png)    |
| Enforcement      | [Dark](evidence/settings-1382/enforcement-dark.png)      | [Light](evidence/settings-1382/enforcement-light.png)      |
| Shared Resources | [Dark](evidence/settings-1382/shared-resources-dark.png) | [Light](evidence/settings-1382/shared-resources-light.png) |
| Doc Freshness    | [Dark](evidence/settings-1382/doc-freshness-dark.png)    | [Light](evidence/settings-1382/doc-freshness-light.png)    |
| Maintenance      | [Dark](evidence/settings-1382/maintenance-dark.png)      | [Light](evidence/settings-1382/maintenance-light.png)      |
| Manage           | [Dark](evidence/settings-1382/manage-dark.png)           | [Light](evidence/settings-1382/manage-light.png)           |

[Native checks](evidence/settings-1382/native-matrix.json), [minimum window with enlarged text](evidence/settings-1382/minimum-enlarged-light.png), [compact actions diagnostic](evidence/settings-1382/compact-actions-light.png).

## Repeatable gates

- 16 focused Settings Vitest files: 55 tests passed.
- Web TypeScript check and changed-file ESLint passed.
- `PLAYWRIGHT_API_PORT=3192 PLAYWRIGHT_WEB_PORT=5192 pnpm exec playwright test e2e/settings-visual-system.spec.ts --project=chromium`: passed on isolated servers. The test covers all destinations in both themes at 16px and 20px, sortable-row layout, consecutive keyboard navigation, and compact actions.
- `pnpm --filter @veritas-kanban/web build` and `pnpm --filter @veritas-kanban/desktop package:mac:dir`: passed after the final layout correction.
- For native reproduction, launch the generated `desktop/release/mac-arm64/veritas-kanban.app` with a separate test user-data directory; open Settings at the recorded bounds, visit the matrix, resize to the native minimum, increase root text, and repeat keyboard checks. Never reuse the installed user's profile for destructive-settings tests.

## Remaining release work

This is Settings-specific evidence, not overall UI or release acceptance. Shared popouts (#1383), template editor (#1384), task workspace (#1385), chat convergence (#1386), release conformance (#1387), maintained screenshot/GIF refresh (#1388), and final packaged-app acceptance (#1389) remain separate. These audit captures do not replace the final maintained documentation media refresh. No installation, signing/notarization, version bump, or release is claimed here.
