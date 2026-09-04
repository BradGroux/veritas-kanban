# Settings skill-risk actions

Issue #1438; parent #1389.

The skill-risk table forced Task and Exception into one non-wrapping flex group. Under constrained Settings widths, the buttons shrank and their labels broke across lines. The group now wraps between buttons, while each action retains its intrinsic width and cannot shrink. Existing variants, icons, handlers, and keyboard semantics are unchanged.

The rendered regression failed on the original label geometry in both themes. After the correction it passes in both themes at 1700×900/16px, 1180×760/20px, and 900×480/20px. It verifies single-line labels, visible actions, containment, keyboard activation of Exception, and exact focus restoration. All write requests are blocked. Each size opens Settings after resizing to avoid racing the shell's breakpoint focus changes. Shared build, web typecheck, and changed-source lint pass; E2E source is formatted but excluded by the repository ESLint configuration.

Packaged macOS acceptance and source CI are pending. The installed app, final docs media, and release are unchanged.
