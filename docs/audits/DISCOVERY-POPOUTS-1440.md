# Discovery popouts (#1440)

Search, Command Palette, and Keyboard Shortcuts adopt the shared popout contract. Search uses one primary body scroller instead of a nested collection scroller and fixed 500px results area. Command Palette keeps its query and shared footer outside its command scroller, with a visible shared header/close action and consistent row insets. Shortcut help uses the shared body/footer and is mounted in the application shell; previously its component was never rendered despite the keyboard state changing.

Rendered handoff checks exposed two focus failures: effect replay replaced the original opener with a background heading, and opening another overlay could cancel queued opener restoration. The shared modal retains the original opener through effect replay and interrupted exit, then restores it before an exit handoff. Search and Command Palette use one cancellable handoff helper; reopening or unmounting cancels queued work, and a newer selection invalidates an older callback. External links still open synchronously from the user gesture.

This slice depends on Settings #1437. Its legacy first-mount focus behavior is not accepted as a substitute for the pending shared Settings implementation.

Twenty-one focused unit tests pass across the shared overlay, command, and search slices. Web typecheck, changed-file lint, formatting, and both source-review axes pass. Browser acceptance passes both themes at 1700×900/16px, 1180×760/20px, and 900×480/20px, plus an animation-enabled interrupted reopening case. Checks cover scrolling, fixed footer, bounds, disabled commands, query/backend selection, Search-to-Settings and command-to-Search/Settings/Create handoffs, route navigation, help mounting, and exact opener restoration. Screenshots were visually inspected; command-row padding was corrected after inspection. A fixture selector initially used the wrong label case; that setup error is separate from the reproduced production focus failures.

Rebuilt packaged macOS acceptance remains pending. This document does not claim installed-app replacement, final maintained screenshots/GIFs, integration CI, or release completion.
