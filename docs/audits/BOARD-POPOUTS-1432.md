# Board popout migration

Issue: #1432. Parent overlay adoption: #1383.

Saved-view creation and rename use the shared form modal. Saved-view deletion, bulk task deletion, and sprint archive confirmation use the shared confirmation modal. All five flows have the standard header, one scrolling body, and a separate footer with shared action sizing. Destructive confirmations initially focus Cancel; name forms initially focus their textbox. Existing save, rename, delete, and archive handlers are unchanged.

## Verification

The focused Board and shared-overlay unit suites pass. Tests cover exact saved-view callback arguments, safe Escape/cancellation, opener focus restoration, footer separation, and synthetic archive/delete confirmation. Shared build, web typecheck, and changed-file lint pass.

The new browser regression passes in both themes at 1180×760 with 16px text and 900×480 with 20px text. Each of the five flows is opened, checked for initial focus, full footer visibility, viewport bounds and horizontal overflow, then dismissed with Escape and checked for exact opener restoration. Long saved-view and sprint names are included. Feature settings, task data, and archive suggestions are synthetic; destructive task requests are intercepted and asserted absent. The smaller browser viewport is not a claim about the native window minimum.

The first unit run required building the shared package in the fresh worktree. The first browser run used a workspace import unavailable from the root test package; it now imports the built shared module by repository-relative path. Both were setup issues, not passing acceptance evidence.

## Packaged macOS verification

Unsigned candidate `bda76b05` was rebuilt with `pnpm desktop:package:mac:dir`. The harness verified `app.isPackaged`, version 6.1.6, and an isolated temporary user-data directory. All five real dialog flows passed in both themes at 1700×900 with 16px text and native minimum 1180×760 with 20px text. Initial focus, footer visibility, viewport bounds, no dialog horizontal overflow, Escape, exact opener restoration, and document-height containment passed. Destructive requests were intercepted and asserted absent. Captures of each dialog family were inspected for padding, action placement, and wrapping.

The inspection also found an independent overflow in the underlying archive-suggestion banner when a sprint name is long and unbroken. That banner can horizontally pan the Board even though the confirmation dialog remains bounded. It is a separate follow-up, not covered by this modal-only acceptance.

Installed-app replacement, other overlay families, final documentation images/GIFs, and release remain unfinished requirements. These diagnostic captures are not the final documentation media refresh.
