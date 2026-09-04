# Settings popout family

Issue #1436; parent #1383.

The Settings root adopts the shared authoring modal, shared header/close geometry, and one primary content scroller with a 1rem inset. Its navigation retains a separate bounded scroller. The previous 85vh shell, local header dimensions, delayed autofocus, and extra hand-written Tab trap are removed. Shared focus trapping remains active.

All ten nested Settings dialogs migrate together: global reset, section reset, managed-list deletion, repository removal, security reset, agent removal, template deletion, tool-policy editing, cleanup preview, and skill exception. Each uses a shared variant with a separately scrolling body and fixed footer. Confirmations initially focus Cancel; cleanup review focuses its visible Close action; other forms focus their first enabled field. Existing permissions and callbacks are unchanged.

The shared build, web typecheck, changed-source lint, and 40 focused Settings unit checks pass. Specification and standards source reviews found no outstanding implementation findings. The all-child browser check passes both themes at 1180×760 with 16px text and 900×480 with 20px text: eleven openings cover all ten nested dialog implementations, including policy creation and editing. Checks cover root containment, exact 1rem content inset, nested parent inertness, initial focus, footer bounds, Tab containment, Escape, exact opener restoration, and blocked mutations. The browser fixture identifies the desktop shell but is not a packaged-app test.

Initial browser attempts corrected test setup errors: the shared variant/inert attributes belong to the modal root rather than its content section, the policy creation action is named New Policy, and theme selection must use the persisted application setting. The all-child fixture also required the agent's mandatory args array. These attempts are not passing acceptance evidence.

Read-only host-preview POSTs have an explicit synthetic response fixture. All other non-read API requests remain blocked and the test observes zero mutations; no reset, deletion, save, cleanup, or launch is performed.

Rebuilt packaged macOS verification, installed-app replacement, final documentation images/GIFs, and release remain unfinished.
