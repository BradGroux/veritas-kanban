# Interrupted overlay exit and opener ownership

Tracking: #1459, discovered during the packaged task-family acceptance for #1444.

A mounted confirmation can be reused before its previous exit animation finishes. The approval and rejection actions share one such dialog. On candidate `88c2b998361a6dcbcce3f37e8abe85d0ef8804bc`, opening Approve once, closing it, then immediately opening and closing Reject returned focus to Approve once. The native reproduction failed twice; inserting a 250ms delay between the actions avoided the failure across eight theme/motion/window combinations. That timing probe is diagnostic evidence, not an accepted workaround.

The shared overlay registration now distinguishes a committed closed state from React effect replay. A new open cycle captures its current external opener without waiting for an exit callback. If a shortcut reopens while focus still belongs to the exiting surface, it retains the previous logical opener instead of capturing one of its own controls. A stable internal surface identifier distinguishes that control from a valid control in a parent overlay. Exit completion checks the current lifecycle ref so it cannot clear a reopened surface's opener.

The focused regression reproduced the original Approve-versus-Reject mismatch before the fix. Coverage also includes immediate shortcut reopening, existing StrictMode replay, nested focus ownership, and overlay handoff cancellation. Native acceptance of the rebuilt candidate remains required; this source change does not establish installed-app, documentation-media, or release completion.
