# Base UI vs Radix UI — Evaluation

> **Date:** 2026-03-08  
> **Status:** Evaluated — **Recommendation: Stay with Radix**

## Current State

VK uses **Radix UI** primitives through shadcn/ui (style: `new-york`, base: `radix`). This has been the default since the project's inception. shadcn v4 introduced a `--base` flag on `shadcn init` that allows choosing between `radix` and `base` (Base UI from MUI).

**Installed components (16):** alert-dialog, badge, button, checkbox, dialog, input, label, popover, scroll-area, select, sheet, skeleton, switch, tabs, textarea, tooltip.

## What Is Base UI?

Base UI is MUI's headless component library — unstyled, accessible primitives similar to Radix but from the Material UI ecosystem. Key characteristics:

- **Headless/unstyled** — provides behavior + accessibility, you bring the styles
- **Smaller bundle** — generally lighter than Radix for individual components
- **React 19 compatible** — actively maintained
- **Fewer components** — smaller catalog than Radix (no scroll-area, sheet, etc.)
- **Different API patterns** — slot-based rendering vs Radix's compound component pattern

## Comparison

| Factor                  | Radix UI                                              | Base UI                                |
| ----------------------- | ----------------------------------------------------- | -------------------------------------- |
| **Bundle size**         | Moderate (~50-80KB for common set)                    | Slightly smaller per-component         |
| **Component count**     | 30+ primitives                                        | ~15 primitives                         |
| **API style**           | Compound components (`Dialog.Root`, `Dialog.Trigger`) | Slot-based (`slots={{ root: 'div' }}`) |
| **Accessibility**       | Excellent (WAI-ARIA compliant)                        | Excellent (WAI-ARIA compliant)         |
| **shadcn integration**  | First-class (default base)                            | Supported via `--base base` flag       |
| **Community/ecosystem** | Large — most shadcn users, tutorials, examples        | Smaller — MUI ecosystem overlap        |
| **Animation support**   | Built-in presence/animation primitives                | Bring your own                         |
| **TypeScript**          | Full type safety                                      | Full type safety                       |

## Migration Effort

Switching from Radix to Base UI would require:

1. **Re-init shadcn** with `--base base` flag
2. **Rewrite all 16 component imports** — different API patterns mean code changes, not just import swaps
3. **Lose compound component patterns** — Radix's `Dialog.Root > Dialog.Trigger > Dialog.Content` becomes flat slot-based props
4. **Replace missing components** — Base UI lacks scroll-area, sheet, and others VK uses. These would need custom implementations or alternative libraries.
5. **Re-test everything** — accessibility, keyboard nav, focus management all need re-verification
6. **Custom components affected** — MarkdownEditor and MarkdownRenderer may depend on Radix primitives

**Estimated effort:** 2-3 days for a developer familiar with both libraries. High risk of subtle regressions in accessibility and keyboard navigation.

## Recommendation

**Stay with Radix.** The reasons:

1. **It works.** VK's UI is stable, accessible, and well-tested with Radix.
2. **shadcn ecosystem alignment.** The vast majority of shadcn examples, templates, and community components assume Radix. Switching introduces friction for every future component addition.
3. **Migration cost > benefit.** The bundle size savings are marginal (~10-20KB gzipped) and don't justify the effort or regression risk.
4. **Missing primitives.** Base UI's smaller catalog means we'd need to find replacements for scroll-area, sheet, and potentially others.
5. **No blocking issue.** There's no pain point with Radix that Base UI solves. This would be change for change's sake.

**When to revisit:** If shadcn makes Base UI the default in a future major version, or if Radix becomes unmaintained. Neither is on the horizon.
