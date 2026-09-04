# Settings skill-risk actions

Issue #1438; parent #1389.

The skill-risk table forced Task and Exception into one non-wrapping flex group. Under constrained Settings widths, the buttons shrank and their labels broke across lines. The group now wraps between buttons, while each action retains its intrinsic width and cannot shrink. Existing variants, icons, handlers, and keyboard semantics are unchanged.

The rendered regression failed on the original label geometry in both themes. After the correction it passes in both themes at 1700×900/16px, 1180×760/20px, and 900×480/20px. It verifies single-line labels, visible actions, containment, keyboard activation of Exception, and exact focus restoration. All write requests are blocked. Each size opens Settings after resizing to avoid racing the shell's breakpoint focus changes. Shared build, web typecheck, and changed-source lint pass; E2E source is formatted but excluded by the repository ESLint configuration.

## Packaged macOS acceptance

`pnpm desktop:package:mac:dir` passed for integration candidate `87ff80adfa84bf6342df23c932c6ac299bf0f239`. The unsigned arm64 app reports version 6.1.6. Its packaged web index SHA-256 is `ce875f5cb4c0b17a9bfbc506bdec053ebb7674f84bf3abead2f042361f8f5fec`; the Settings bundle `SettingsDialog-BEBS0fhe.js` is `edf17be583847b6765eec3c4d9bfbdf05b47e7aef34ce2acc4733fcaa8a87476`. These identify the separately packaged web assets; `app.asar` contains the desktop wrapper and is not a UI asset identifier.

The real packaged app passed the focused action-label checks in both themes at 1700×900/16px and the native minimum 1180×760/20px. Task and Exception labels stay on one line, actions remain fully visible, the outer Settings dialog has no horizontal overflow, and Exception keyboard opening/Escape restores the exact opener. This original check did not inspect the inner Settings content scroller; the correction below addresses that gap. Both enlarged-text captures were visually inspected. The disposable profile observed zero unexpected mutations and the owned app was closed afterward.

Native command: `NATIVE_SCOPE=risk-actions pnpm --filter @veritas-kanban/server exec tsx /tmp/vk-native-ui-1389.8cJNtK/verify.mjs` from the integration worktree. Diagnostic images are `/private/tmp/vk-native-ui-1389.8cJNtK/settings-risk-actions-{light,dark}-{1700,1180}.png`, not final maintained media. Both specification and standards source reviews found no outstanding findings.

Source CI and the parent Settings PR are pending. The installed app, final docs media, remaining audit work, and release are unchanged.

## Inner content containment correction

Integration QA run `33830608672` exposed horizontal panning inside Settings. A stronger check on `[data-settings-content-scroll]` failed in both themes: the intrinsic table width escaped its card and widened the entire Settings content scroller. The table now has its own native, keyboard-focusable, named scroll region with a text-scaled minimum width. Buttons retain their intrinsic widths and a small horizontal scroll margin; measured nearest-edge scrolling otherwise clipped 0.75px of the Exception button.

The revised exact browser regression passes in both themes at all three sizes above, with zero retries and zero write requests. It checks the inner and outer containment boundaries, ArrowRight scrolling within the table, full action visibility, single-line labels, and Exception activation/dismissal focus. Web typecheck and changed-source lint pass. Both specification and standards reviews found no actionable findings.

The corrected integration candidate `f12214f4eaae13c92397721dad69d1a74da4db8d` passed `pnpm desktop:package:mac:dir` and the strengthened `NATIVE_SCOPE=risk-actions` check in both themes at 1700×900/16px and 1180×760/20px. Its packaged web index SHA-256 is `fbb6891717c7bf5343909f54c9d6de801726083513748f2325826a22f7be2788`; `SettingsDialog-DsKfXoJc.js` is `e643cb830a1e7f86c0d1e0e19af5acfc822d3806357d020115b2d454d90db3fe` and matches the built source asset byte-for-byte. Native checks now explicitly prove no horizontal overflow or panning in the inner Settings content scroller, local keyboard scrolling, intact actions, and Exception focus restoration. Both enlarged-text captures were inspected. Zero unexpected mutations occurred; the disposable app was closed. This supersedes the narrower original containment evidence, but does not replace the installed app or refresh final maintained media.
