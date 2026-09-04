# Create Task popout

Issue #1426 is a bounded consumer migration under #1383. The packaged comparison with Template authoring exposed legacy title, padding, and footer treatment in Create Task.

Create Task now uses the shared form-width modal, one bounded scrolling body, and a fixed footer with shared actions. Fields retain the existing task/template/blueprint state and creation path. Title is the initial focus target. Opening the inline New Project editor focuses its input; Escape or Cancel returns to the Project selector without closing the task dialog. Ordinary dialog close continues to retain the current draft.

The browser regression covers light/dark at 900×480 with 20px text, equal paired-select widths, dropdown Escape, inline-project Escape and focus, footer reachability, outer overflow, and retained values across close/reopen. It is written but not yet executed. Touched web typecheck and changed-source lint passed. The shared migration has no nested modal child: blueprint preview and template variables are inline, and duplicate-result navigation closes Create Task before task inspection.

Spec review found no implementation blocker. Standards review identified the Cancel action role and insufficient scroll assertions; both were corrected and rechecked without remaining findings. Browser integration, packaged macOS verification, installed-app acceptance, and documentation-media refresh remain pending. This slice does not close the remaining overlay inventory.
