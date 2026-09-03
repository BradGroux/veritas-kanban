# Popout foundation verification

Issue #1401 is the independently reviewable foundation and Template family slice of #1383. The overall popout audit remains open. Settings, Task, Chat, Search, Policy, Workflow, utility, and compatibility-wrapper families must migrate atomically with their descendants.

## Completed local gates

- Focused component tests: 12 passed, covering all six variant contracts, nested Escape, explicit Escape guards, StrictMode/subtree focus restoration, and the Template editor.
- Browser regression: four tests passed in dark/light themes, including all six variants at 1180×760 and 900×480, increased root text size, reduced motion, portaled Select interaction, menu-first Escape, nested focus restoration, state retention, and the real Template category/type/priority/agent selectors and fixed actions.
- Web typecheck, changed-file lint, formatting, diff checks, production web build, and unsigned macOS packaging passed.
- Standards and spec reviews found two initial integration errors: overlay elevation covered dropdowns, and partially migrated Settings descendants used an incompatible focus stack. The final slice uses Mantine's modal elevation below popovers and defers entire remaining parent/child families. Canonical widths are enforced.

## Native candidate result and remaining gate

The rebuilt unsigned arm64 candidate reports `app.isPackaged=true`, Electron 44.1.1, and application version 6.1.6. It runs with an isolated test profile; the installed application and its board data were not replaced.

The native reduced-motion check exposed a real restoration race: autofocus and restoration ran while the parent was still CSS-hidden. A targeted visibility override made the same check pass. The implementation now leaves inactive parents visible behind the scrim but inert to input and accessibility navigation. Rebuilt native interaction assertions subsequently passed for all six variants and real Template menus.

Native screenshot acceptance is still pending. A second capture pass asserted viewport and control bounds immediately before capture and added paint settling. Interaction assertions passed across all six variants in both themes at normal and enlarged text, including reduced motion, dropdown layering, nested Escape/focus restoration, retained draft state, and fixed footers. Actual Template preview and delete-confirmation cancellation passed in both themes, with opener focus restored and the record retained.

The inspected captures are not uniformly acceptable: the normal dark Task drawer capture still appears partially clipped despite passing measured bounds. Paint settling improved other captures but did not establish whether the remaining discrepancy is capture behavior or a product rendering defect. Do not attribute this solely to external window interaction or count the entire image matrix as passed. Raw attempts remain local diagnostic evidence. Reproduce the Task drawer discrepancy against the visible native window, resolve it, and inspect every accepted image before marking #1401 complete. Populated Template card action wrapping at enlarged text remains separately tracked under #1384.

Latest tested integration candidate: `d181a26a7999c5ec0da456cfe30933b164a9e65e`, combining this foundation with independent Settings, Policy action, and keyboard fixes. Candidate shell SHA-256: `5a5829cfee4dbe3877eac890920919cd181891c2cb46ebe86e2ec788cf65c830`. Packaged web index SHA-256: `58139e42dd2b55e367fab13a92c7b4ebabca9cbbe64790b67d7034fcff96070d`.

## Not delivered by this slice

This is not installed-release acceptance, the feature-specific Template redesign (#1384), Task/Chat convergence (#1385/#1386), release conformance (#1387), or the final maintained documentation screenshot/GIF refresh (#1388). The native Policy Edit/Test wrapping regression is tracked independently in #1402. The populated Operations Digest heading failure blocking PR #1398 is #1400.
