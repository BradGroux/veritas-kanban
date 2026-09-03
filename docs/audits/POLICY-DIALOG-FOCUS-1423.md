# Policy dialog focus restoration

Issue #1423 follows the keyboard activation fix in #1407. Full integration runs [33816771758](https://github.com/BradGroux/veritas-kanban/actions/runs/33816771758) and [33817019675](https://github.com/BradGroux/veritas-kanban/actions/runs/33817019675) both failed the exact Test opener focus assertion after sequential Edit and Test dialogs. The other 58 browser tests passed and one was skipped. The earlier native audit waited for initial dialog focus; it did not cover dismissal during opening.

PolicyManager still used two raw Mantine Modals outside the shared overlay stack. Its independent initial-focus and return-focus timers can race during early Escape. The recorded failing interaction presses Escape about 30ms after opening Test. This change uses the existing UiModal registration/restoration lifecycle for both dialogs, with the authoring and form geometry variants. It does not add a timeout, change global keyboard dispatch, or change policy evaluation or persistence.

The browser regression retains immediate Escape, repeats Edit/Test twice, asserts the actual opener after each close, and adds ordinary Cancel restoration. Existing shared-overlay tests cover nested/topmost Escape and subtree unmounts. Typecheck, changed-source lint, formatting, and diff checks passed before publication. Updated browser execution and full integration acceptance are pending; this document is not a green runtime claim. Packaged macOS acceptance remains part of the combined UI gate.

Keep #1423 and the full integration PRs open until the runtime gates pass. Do not substitute a wait for initial focus or an arbitrary sleep for the early-dismissal assertion.
