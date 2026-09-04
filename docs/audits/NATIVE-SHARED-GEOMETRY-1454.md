# Effective shared native geometry (#1454)

Primary page headings use a 1.5rem font size and 2rem line height. The task drawer body has no outer padding; task header, navigation, content, and chat sections own their insets. These values are applied through the component style boundary because unlayered Mantine defaults override normal Tailwind utilities in the packaged production renderer.

The preceding native candidate measured 34px/44.2px heading typography and 12px drawer body padding at a 16px root size, despite the intended utility classes. The strengthened #1387 contract rejects those values. Focused regressions assert the effective inline declarations while the packaged matrix verifies actual computed layout at normal and minimum window sizes in both themes. The change does not alter heading semantics, navigation handlers, nested overlay ownership, or task state preservation.

Native gate reports and candidate identity remain separate from installed-app, signing, documentation media, and release acceptance. A passing geometry check alone does not complete those boundaries.
