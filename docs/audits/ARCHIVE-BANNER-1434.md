# Long sprint archive-banner containment

Issue: #1434.

The archive banner allowed its unbroken sprint name to set the flex item's minimum width, leaving its actions outside the Board and causing horizontal panning when focused. The text item now permits shrinking and wraps long words; the action group can move to another line. Archive, dismiss, and confirmation handlers are unchanged.

The focused browser regression failed on the old source in both themes because the banner's scroll width exceeded its client width. It then passed in both themes at 1180px with 16px/20px text and 620px with 20px text. It checks the banner and title width, full archive/dismiss visibility, unchanged horizontal position after opening and cancelling confirmation, and dismissal. Fixtures intercept task/settings/sprint reads and prohibit real archive requests. The smaller browser viewport is not a native-window claim. Web typecheck and changed-source lint pass; no dependencies changed.

Packaged macOS verification remains pending. The installed app, final documentation media, other UI consumers, and release acceptance are unchanged and unfinished.
