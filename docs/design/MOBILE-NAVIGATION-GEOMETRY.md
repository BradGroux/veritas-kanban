# Mobile Board navigation geometry

Tracking: #1462. Home returns to the top of the board page; Board positions the columns immediately below the sticky toolbar after their content mounts.

Measure the toolbar at activation, including enlarged text. Round the resulting scroll offset down to a whole CSS pixel: browsers can round fractional offsets upward and obscure the top of a column. This intentionally permits less than one pixel of clearance instead of any overlap.

The existing `e2e/mobile-board-scroll.spec.ts` browser checks cover navigation from Activity and repeated Home/Board activation at 390px and 430px widths with 16px and 20px root text. They require zero overlap and at most two pixels of clearance. At 390px with 20px text, the regression was a 73.5px toolbar and a requested 453.5px scroll offset that Chromium rounded to 454px, obscuring 0.5px of the board.

These browser checks do not establish packaged macOS, signed-release, or documentation-media acceptance. Those remain separate integration gates.

## Late dashboard content

Tracking: #1495. The embedded dashboard's enforcement status and update timestamp wrap onto separate lines when they cannot fit side by side. Both remain visible. A below-the-fold row can expand the mobile layout viewport even while the user is interacting with Chat near the top of the page; fixed navigation then moves outside the visual viewport.

`e2e/mobile-dashboard-status.spec.ts` waits for the lazy dashboard to load at 320px with enlarged text, checks both status items and the page width, then verifies Chat close/reopen with draft retention. Do not replace this with a check made before the dashboard mounts, broad overflow clipping, or forced clicks.

## Populated Activity containment

Activity rows must fit the viewport rather than expanding the mobile layout viewport around fixed navigation. Below the small-screen breakpoint, timestamp/status controls may wrap and task identity occupies a separate line with a wrapping ID and title. Wider layouts retain the existing single-row arrangement. No status, ID, or title is hidden to make the row fit.

`e2e/mobile-navigation-hit-target.spec.ts` supplies populated Activity records with realistic-length IDs independently of prior tests. It checks layout width, all navigation and Chat hit targets, and pointer/keyboard return to Board at narrow widths, enlarged text, and both motion preferences. The original 320px case expanded the layout viewport to 424px while the visual viewport remained 320px; increasing navigation z-index would not fix that mismatch.

## Enlarged navigation labels

Tracking: #1465. Narrow navigation buttons give their full grid-cell width to the label, with spacing between buttons supplied by the grid gap. Do not spend that width on horizontal button padding or shrink the text to fit. The Settings label needs more space with wider platform fonts; the 320px, 20px-text regression measured a 72px word in a 67px content box.

`e2e/mobile-readable.spec.ts` includes a wider-platform-font case in addition to the default-font size/theme matrix. It checks every full label, 44px minimum touch targets, hit testing, and content clearance. This remains browser coverage, not final documentation-media or packaged-app acceptance.
