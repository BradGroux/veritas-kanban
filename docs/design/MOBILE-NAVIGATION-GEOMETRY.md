# Mobile Board navigation geometry

Tracking: #1462. Home returns to the top of the board page; Board positions the columns immediately below the sticky toolbar after their content mounts.

Measure the toolbar at activation, including enlarged text. Round the resulting scroll offset down to a whole CSS pixel: browsers can round fractional offsets upward and obscure the top of a column. This intentionally permits less than one pixel of clearance instead of any overlap.

The existing `e2e/mobile-board-scroll.spec.ts` browser checks cover navigation from Activity and repeated Home/Board activation at 390px and 430px widths with 16px and 20px root text. They require zero overlap and at most two pixels of clearance. At 390px with 20px text, the regression was a 73.5px toolbar and a requested 453.5px scroll offset that Chromium rounded to 454px, obscuring 0.5px of the board.

These browser checks do not establish packaged macOS, signed-release, or documentation-media acceptance. Those remain separate integration gates.
