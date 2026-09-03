# Policy action layout (#1402)

The 190px Actions column compressed flex children while shared labels permitted arbitrary word breaks. Edit consequently rendered four lines tall at a normal 1360px window. The column now reserves 16rem, action buttons do not shrink, and the adjacent Type column reserves enough space for its pills; whole controls may wrap within the group without breaking labels into arbitrary characters.

The browser regression failed before the fix and passes afterward in light/dark, 1180/1360px widths, 16/20px text, and both sidebar states. It checks three built-in Edit actions, single-line/unclipped Edit and Test labels, bounded Risk Threshold pills, and correct dialog opening. Web typecheck and changed-file lint pass.

Packaged macOS geometry and keyboard acceptance passed in both themes at 1180x760 with 20px text on integration candidate `d181a26a7999c5ec0da456cfe30933b164a9e65e`, including the independent keyboard fix in PR #1408. Focused Enter opens Edit/Test; Escape after initial dialog focus restores the opener. The Type and action labels are readable in the inspected native captures. The packaged web index hash is `58139e42dd2b55e367fab13a92c7b4ebabca9cbbe64790b67d7034fcff96070d`.

The related audit found Policy is the only DataTable consumer. Populated Template cards have a separate non-wrapping action-group problem at enlarged text, retained under the open Template redesign #1384. Do not treat the Policy fix as completion of that surface, the larger desktop audit, or the final documentation media refresh. The installed app is unchanged.
