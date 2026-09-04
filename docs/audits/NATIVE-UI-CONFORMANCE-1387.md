# Packaged macOS UI conformance (#1387)

Status: in development. This gate is not yet release acceptance and #1387 remains open.

## Boundary

`pnpm desktop:ui:mac <candidate.app> <new-evidence-directory>` launches that actual packaged Electron executable through Playwright. It verifies the production preload identity, embedded build SHA, package path, and disposable user-data path. It does not start Vite, inject a fake desktop bridge, replace the installed app, or use the operator's task data. Authentication and task/template persistence use the isolated packaged server. The text-artifact preview is explicitly identified as read-only fixture data; it does not certify PDF rendering, provider execution, or artifact registration.

Build the candidate with `VERITAS_BUILD_SHA` set to the exact candidate commit before running. The fixed matrix covers expanded-width 1700×760 and minimum 1180×760 content sizes in both themes at 100% zoom. The shared 760px height is deliberate: hosted macOS runners expose a 760px usable content area, while the two widths still exercise expanded and compact shell behavior. These are native content dimensions, not a claim that the outer window has those dimensions. Evidence separately records outer bounds, content bounds, display scale, minimum window size, macOS version, and app version/build.

The report hashes the entire bundle, including server/web resources and framework binaries. Each state retains its route, geometry, native `BrowserWindow.capturePage()` PNG, and screenshot digest. Captures wait for active overlays and their ancestors to become opaque, then allow two animation frames for painting. These are native renderer captures, not pictures of the macOS menu bar or window shadow. A failed state remains in the required matrix. Startup failures are recorded without taking authentication screenshots or disclosing passwords/recovery keys. Temporary test profiles are retained outside the repository and contain synthetic data only.

`pnpm desktop:ui:verify <evidence.json> <candidate.app>` rehashes the package and screenshots. It rejects incomplete/duplicate/failed entries, unbound builds, dirty candidates, wrong commits/versions/packages, stale reports, missing native environment, cropped or modified PNGs, transparent overlays, and shell geometry failures before and after interactions. It is a native-evidence verifier, not yet the release workflow's publication gate.

Primary routes also record heading, Back, header, and content rectangles. Checks enforce the shared typography, icon-only Back sizing/placement, route-title semantics, and cross-route alignment. Overlay parts record their actual computed padding against the shared rem-based inset contract, including intentionally unpadded compound/task containers. The runner's final status includes structural verification; an unexpected viewport or invalid recorded layout cannot remain a passing run merely because its clicks succeeded.

Final verification also examines the complete recorded HTTP-failure ledger after the app closes. A recorded rate limit (429) or server error (5xx) rejects the run even if every scenario had already passed. Seeded-renderer checks and teardown have their own active-state labels. Missing or malformed HTTP evidence fails closed; an optional chat session returning 404 is not treated as a server failure. Shutdown errors must be fixed, not discarded to obtain a passing report.

After the normal matrix, the disposable renderer receives six deliberately injected faults: blank shell space, a clipped modal, a shifted heading, a board-only rail control on Activity, wrong popout padding, and a visible New Task button with its handler removed. Each fault must be detected by the corresponding geometry or behavioral assertion, retains a native screenshot, and is removed by reloading before the next fault. These expected-failure probes are separate from the ordinary matrix and cannot waive an ordinary failed state. Missing fault probes fail verification.

## Development checkpoint

The first complete development matrix reproduced Session menu Escape dismissal failure in both themes and both native window sizes. This is tracked separately in #1451; the runner must not waive it. Preview capture timing also exposed a harness defect: DOM content and geometry could pass while the native screenshot caught a transparent opening modal. Opacity measurement and paint synchronization address that defect, and the normal/minimum light-theme preview captures were visually rechecked.

The diagnostic run completed at `2026-09-04T06:38:33.197Z` with 144 recorded states and four interaction failures, all Session menu Escape checks. The stricter verifier additionally rejected the normal light Workflows capture because the native content size changed to 1710×1073 instead of 1700×1000. The cause of that window-size change is not established. Capture/completion mode assertions now also fail the scenario immediately when this happens; the runner's earlier 140-pass count is not an accepted matrix. Final native verification must rerun the latest committed runner.

The first signed 6.1.7 capture run then proved the 1700×1000 target itself was not portable: the hosted macOS window manager returned 1700×760 for every normal resize, so that single failed precondition cascaded across the normal matrix and all seeded probes. The current contract centralizes runner-safe content sizes for native verification and documentation capture. This is a harness correction, not accepted evidence; a new commit-bound signed candidate must pass the complete matrix.

These diagnostic runs use an unsigned 6.1.6 package built from `afb447156fd77d24ee4616bdd7f8e556371c4925`, with whole-bundle SHA-256 `52dad82a58e5352c77577d9547323f1ff1cece318e94a22ea415bd93104bc183`. The harness checkout was dirty. They are not clean-commit release acceptance, installed-app verification, or refreshed documentation media. Committing this harness changes HEAD and requires a newly built candidate for final acceptance; old evidence must not be relabeled.

## Remaining acceptance work

- Integrate the Session menu fix from #1453 and rerun the newly strengthened matrix. Its preceding 144-state clean candidate passed, but predates the new geometry fields and seeded renderer requirements.
- Bind refreshed maintained screenshots/GIFs to their capture candidate and reject stale media. Do not relabel the existing browser captures as native evidence.
- Integrate mandatory evidence verification into release validation and signed packaging before any upload. The current workflow uses `electron-builder --publish always`; adding a check after that command would be too late.
- Update release and issue templates to distinguish browser, packaged candidate, installed app, signing, documentation, and publication boundaries.
- Review the complete change and rerun the final clean, commit-bound candidate. Current development runs do not qualify for a release.
