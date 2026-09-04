# Long sprint archive-banner containment

Issue: #1434.

The archive banner allowed its unbroken sprint name to set the flex item's minimum width, leaving its actions outside the Board and causing horizontal panning when focused. The text item now permits shrinking and wraps long words; the action group can move to another line. Archive, dismiss, and confirmation handlers are unchanged.

The focused browser regression failed on the old source in both themes because the banner's scroll width exceeded its client width. It then passed in both themes at 1180px with 16px/20px text and 620px with 20px text. It checks the banner and title width, full archive/dismiss visibility, unchanged horizontal position after opening and cancelling confirmation, and dismissal. Fixtures intercept task/settings/sprint reads and prohibit real archive requests. The smaller browser viewport is not a native-window claim. Web typecheck and changed-source lint pass; no dependencies changed.

Specification and standards reviews found no actionable gaps.

Rebuilt unsigned candidate `07c5ae972f795251244fd255f2062c43fc8aa11c` passed the packaged macOS check with isolated temporary user data. The harness verified `app.isPackaged` and version 6.1.6. In both themes at 1700×900 with 16px text and native minimum 1180×760 with 20px text, the long unbroken sprint name wraps within the banner, both actions remain fully visible, and opening and cancelling the Board dialogs does not horizontally pan the banner. Destructive requests were intercepted and asserted absent. Native light/dark captures at 1180px were visually inspected. The candidate also contains the separately reviewed #1432 shared Board dialogs.

The installed app, final documentation images/GIFs, other UI consumers, and release acceptance remain unfinished. These native diagnostic captures are not the final documentation media refresh.
