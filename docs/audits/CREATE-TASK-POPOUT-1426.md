# Create Task popout

Issue #1426 is a bounded consumer migration under #1383. The packaged comparison with Template authoring exposed legacy title, padding, and footer treatment in Create Task.

Create Task now uses the shared form-width modal, one bounded scrolling body, and a fixed footer with shared actions. Fields retain the existing task/template/blueprint state and creation path. Title is the initial focus target. Opening the inline New Project editor focuses its input; Escape or Cancel returns to the Project selector without closing the task dialog. Ordinary dialog close continues to retain the current draft.

The browser regression passed in light/dark at 900×480 with 20px text, covering equal paired-select widths, dropdown Escape, inline-project Escape and focus, footer reachability, outer overflow, and retained values across close/reopen. The first run omitted the desktop bridge fixture and failed the outer-document assertion; the corrected fixture explicitly asserts desktop mode without weakening the bounds checks. Existing duplicate-detection unit tests passed (4 tests). Touched web typecheck and changed-source lint passed. The shared migration has no nested modal child: blueprint preview and template variables are inline, and duplicate-result navigation closes Create Task before task inspection.

Spec review found no implementation blocker. Standards review identified the Cancel action role and insufficient scroll assertions; both were corrected and rechecked without remaining findings.

The rebuilt unsigned macOS candidate passed the listed geometry, focus, dropdown/project Escape, draft retention, and real creation checks in light/dark at the native minimum 1180×760 with 20px text. Choosing Critical initially exposed the independent API rejection tracked in #1428; after that fix was integrated, the exact scenario created the task and found it again after reload. The card locator was corrected to account for its full accessibility metadata. Stable recapture showed the dark submit label; an earlier capture had omitted it despite the native interaction passing. Captures remain diagnostic, not final documentation media.

Native template-assisted creation subsequently passed in both themes: Create Task inherited the saved template's Critical priority and edited Markdown, created a real task, and found it on the board. The blueprint case exposed the independent API omission in #1430. With that fix included, a two-task blueprint accepted a custom variable and persisted subtask titles, acceptance criteria, and generated dependency IDs through reload in both themes. Template discovery alone was supplied by the blueprint fixture; task creation and storage were real. The inline custom-variable example now uses the parser's required `{{custom:bugId}}` syntax.

Final installed-app acceptance and documentation-media refresh remain pending. This slice does not close the remaining overlay inventory.
