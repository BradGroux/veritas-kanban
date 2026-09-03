# Focused control keyboard acceptance

The global board shortcut handler canceled Enter on focused buttons before the browser could activate them. Native elements and composite widget roles now own their keys; previously handled events do not execute a second board shortcut. Board-background shortcuts retain their existing behavior.

Four native-control unit cases and the actual Policy browser test failed before the fix. Afterward, 21 focused tests and the Policy browser test pass, including nested widget targets, already-handled events, native Select navigation, Enter activation, and Escape focus restoration. Web typecheck and changed-file lint pass. Independent standards and specification review found no blockers.

Packaged macOS acceptance passed on 2026-09-03 with Electron 44.1.1, an unsigned arm64 6.1.6 candidate, an isolated profile, and 1180x760 content with 20px root text in both themes. Edit and Test open via focused Enter. After the dialog's initial focus is established, Escape closes it and restores the matching opener. Final policy button/type labels are readable in both inspected native captures. Pressing Escape before the dialog acquires focus is not used as evidence for completed focus restoration.

Integration candidate source: `d181a26a7999c5ec0da456cfe30933b164a9e65e`. It includes popout foundation `1bee9174`, Settings alignment `2c3cf262`, Policy geometry `1999d3f5` and `21eaeac5`, and keyboard fix `1a306087`. Packaged web index SHA-256: `58139e42dd2b55e367fab13a92c7b4ebabca9cbbe64790b67d7034fcff96070d`. The installed application was not replaced. This is not release or whole-app audit acceptance.

Accepted native captures: [light](evidence/keyboard-1407/policies-light.png), [dark](evidence/keyboard-1407/policies-dark.png), and [interaction results](evidence/keyboard-1407/native-keyboard.json). These are audit evidence, not the final maintained documentation media set.
