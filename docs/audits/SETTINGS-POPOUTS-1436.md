# Settings popout family

Issue #1436; parent #1383.

The Settings root adopts the shared authoring modal, shared header/close geometry, and one primary content scroller with a 1rem inset. Its navigation retains a separate bounded scroller. The previous 85vh shell, local header dimensions, delayed autofocus, and extra hand-written Tab trap are removed. Shared focus trapping remains active.

All ten nested Settings dialogs migrate together: global reset, section reset, managed-list deletion, repository removal, security reset, agent removal, template deletion, tool-policy editing, cleanup preview, and skill exception. Each uses a shared variant with a separately scrolling body and fixed footer. Confirmations initially focus Cancel; cleanup review focuses its visible Close action; other forms focus their first enabled field. Existing permissions and callbacks are unchanged.

The shared build, web typecheck, changed-source lint, and 40 focused Settings unit checks pass. Specification and standards source reviews found no outstanding implementation findings. The all-child browser check passes both themes at 1180×760 with 16px text and 900×480 with 20px text: eleven openings cover all ten nested dialog implementations, including policy creation and editing. Checks cover root containment, exact 1rem content inset, nested parent inertness, initial focus, footer bounds, Tab containment, Escape, exact opener restoration, and blocked mutations. The browser fixture identifies the desktop shell but is not a packaged-app test.

Initial browser attempts corrected test setup errors: the shared variant/inert attributes belong to the modal root rather than its content section, the policy creation action is named New Policy, and theme selection must use the persisted application setting. The all-child fixture also required the agent's mandatory args array. These attempts are not passing acceptance evidence.

Read-only host-preview POSTs have an explicit synthetic response fixture. All other non-read API requests remain blocked and the test observes zero mutations; no reset, deletion, save, cleanup, or launch is performed.

## Packaged macOS acceptance

The unsigned arm64 Electron candidate at integration commit `4f747e6f14c3e90549644dabf46aff29b658620f` was rebuilt with `pnpm desktop:package:mac:dir`. Its packaged `app.asar` SHA-256 is `57e855b0ab4d3a107ada9d9fe5dcdb6aea31e69c6cb73453cd27e195cf4b9aaf`. The application reports version 6.1.6 and `app.isPackaged` was asserted; this is not a signed release.

All eleven child openings passed in both themes at 1700×900 with 16px text and the native minimum 1180×760 with 20px text. Checks prove root and child containment, 1rem body inset, parent inertness, fully visible initial focus, footer bounds, Tab containment, Escape, exact opener restoration, and no document overflow. The five Tasks fields identified in the alignment report also share their left edge, width, and height within 2px, including unit-bearing fields and Default Priority. All mutations were blocked after isolated-profile onboarding, with zero unexpected write requests.

Screenshot review of the first candidate exposed an offscreen cleanup confirmation focus target despite a passing focus assertion. Initial focus was moved to the fixed-footer Close action. Both browser cases and four Maintenance unit tests passed again; both review axes found no outstanding findings. The rebuilt final native run passed the stricter fully-visible-focus assertion and its cleanup capture shows the focus ring on Close.

Diagnostic screenshots and the local native harness are under `/private/tmp/vk-native-ui-1389.8cJNtK/`; run with `NATIVE_SCOPE=settings-popouts pnpm --filter @veritas-kanban/server exec tsx /tmp/vk-native-ui-1389.8cJNtK/verify.mjs` from the integration worktree. The owned application was closed after verification. These captures are not final maintained documentation media.

Source CI, installed-app replacement, final documentation images/GIFs, the remaining whole-app audit, and release remain separate unfinished gates.
