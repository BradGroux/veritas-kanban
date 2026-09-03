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

Native screenshot acceptance is still pending. The visible candidate window changed size/navigation between capture steps, so the captured image set does not reliably establish the requested fixed-size matrix. Raw attempts are retained locally for diagnosis, not included as accepted screenshots in this change. Re-run in an uninterrupted capture window, assert viewport and control bounds immediately before every capture, inspect every accepted image, and verify actual Template preview/delete-confirmation surfaces before marking #1401 complete.

Candidate shell SHA-256: `5a5829cfee4dbe3877eac890920919cd181891c2cb46ebe86e2ec788cf65c830`. Packaged web index SHA-256: `42d361766cedf0eef46e995c17655644000efe43801e08b1b21a04c6f61df133`.

## Not delivered by this slice

This is not installed-release acceptance, the feature-specific Template redesign (#1384), Task/Chat convergence (#1385/#1386), release conformance (#1387), or the final maintained documentation screenshot/GIF refresh (#1388). The native Policy Edit/Test wrapping regression is tracked independently in #1402. The populated Operations Digest heading failure blocking PR #1398 is #1400.
