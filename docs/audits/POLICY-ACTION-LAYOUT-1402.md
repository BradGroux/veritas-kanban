# Policy action layout (#1402)

The 190px Actions column compressed flex children while shared labels permitted arbitrary word breaks. Edit consequently rendered four lines tall at a normal 1360px window. The column now reserves 16rem, and action buttons do not shrink; whole controls may wrap within the group.

The browser regression failed before the fix and passes afterward in light/dark, 1180/1360px widths, 16/20px text, and both sidebar states. It checks three built-in Edit actions, single-line/unclipped Edit and Test labels, and correct dialog opening. Web typecheck and changed-file lint pass.

Packaged native verification, keyboard/focus acceptance, and the related action-group audit remain pending. Do not treat this source fix as completion of the larger desktop audit or final documentation media refresh.
