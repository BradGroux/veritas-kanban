# v5 Release Evidence Packets

## v5.2.2 Release Evidence Packet

This section records the July 2026 UI-audit remediation and v5.2.2 release
state. It supplements the retained v5.0.0 evidence below. Evidence is limited
to public issue, pull request, workflow, and sanitized command results.

### Executive Summary

v5.2.2 fixes the Electron packaging defect that made the signed v5.2.1 macOS
application recursively launch the npm installer shim instead of opening a
window. It also completes the six web findings from the Apple-design audit:
keyboard board movement, compact Settings and navigation, reachable mobile
Board Chat, responsive Scoring Profiles, preference-aware overlays, and
compositor-safe dashboard motion.

The source release is published from `4b84eccd1bf827c842e93a82afd0240e6855b3df`.
The production signing workflow successfully applies the Developer ID
Application signature, but Apple notarization returns HTTP 403 because the team
has a missing or expired agreement. The GitHub release therefore has no macOS
assets and explicitly warns users not to install it yet. Signed installation,
update, checksum, Homebrew, and final Gatekeeper evidence remain pending #809.

| Field               | Value                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Release version     | 5.2.2                                                                                       |
| Git tag             | `v5.2.2`                                                                                    |
| Release commit      | `4b84eccd1bf827c842e93a82afd0240e6855b3df`                                                  |
| GitHub release      | <https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.2>                           |
| Desktop Release run | <https://github.com/BradGroux/veritas-kanban/actions/runs/29213420721>                      |
| Release state       | Source published; signed/notarized macOS assets blocked by Apple team agreement             |
| Evidence date       | 2026-07-12                                                                                  |
| Toolchain           | macOS 26.5.1; Node 26.5.0; pnpm 11.1.1; Playwright Chromium and WebKit; Docker legacy build |

### Issue And Pull Request Traceability

| Issue | Priority     | Outcome                                                                                               | Pull request    | State                                                  |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| #809  | Critical     | Externalize Electron runtime APIs, reject emitted installer shims, and restore a single native window | #817            | Code merged; signed installed-build acceptance pending |
| #810  | High         | Make compact Settings navigation visible and stack dense controls                                     | #820            | Closed                                                 |
| #811  | High         | Prevent mobile navigation collisions and restore Board Chat                                           | #821            | Closed                                                 |
| #812  | High         | Restore keyboard movement, ordering, announcements, rollback, and focus                               | #818            | Closed                                                 |
| #813  | Medium       | Add a deliberate compact Scoring Profiles master-detail flow                                          | #826            | Closed                                                 |
| #814  | Medium       | Remove layout-driven dashboard animation and honor reduced motion                                     | #822            | Closed                                                 |
| #815  | Medium       | Honor transparency/contrast preferences and dismiss stale tooltips                                    | #819            | Closed                                                 |
| #816  | Tracker      | Apple-design audit coverage and final native follow-up                                                | #817-#822, #826 | Open until #809 signed acceptance completes            |
| #828  | Release QA   | Repair stale release E2E selectors without changing product behavior                                  | #829            | Closed                                                 |
| #830  | Release docs | Preserve this evidence and the v5.2.2 freshness sweep                                                 | pending         | In progress                                            |

PR #824 additionally stabilized storage mutation ordering and asynchronous
startup/teardown behavior discovered while exercising the release candidate.
PR #827 aligned all workspace versions at 5.2.2 and published the release
source. Tracker #796 remains open for a non-sensitive external follow-up; its
private advisory context is intentionally not reproduced here.

### Electron Root Cause And Remediation

The desktop Vite/Rolldown build bundled the npm `electron` package shim into
`desktop/out/main/index.js`. At runtime, code expecting Electron APIs received
the shim's executable-path export and recursively spawned `install.js`, so the
development build and signed v5.2.1 application never rendered a window.

PR #817 keeps `electron` and `electron/*` imports external in main and preload
output, adds artifact assertions for forbidden shim markers and required API
bindings, and adds packaged-launch coverage. The patched development build and
local unsigned v5.2.2 package each launched one native application window with
no installer recursion. Native setup, server/renderer readiness, Keychain
status, menus, keyboard onboarding, window chrome, and notification command
wiring were exercised. Close/reopen, updater, VoiceOver, and the rest of the
signed installed-build matrix cannot be completed until Apple notarization
succeeds.

### Interface Outcomes

- Keyboard users can move tasks within and across columns, including empty
  columns, with accurate instructions/announcements and predictable focus.
- Settings, mobile navigation, Board Chat, and Scoring Profiles remain usable at
  320-430 px without hidden actions or page-level horizontal overflow.
- Overlay materials become solid and more strongly bounded for reduced
  transparency or increased contrast; opening Task Detail dismisses its
  trigger tooltip.
- Dashboard transitions name explicit properties and avoid animated layout
  dimensions. Reduced-motion state changes are immediate.
- Focus states, accessible names, touch-sized primary actions, light/dark
  themes, and responsive layouts were covered by focused tests and runtime QA.

### Verification Matrix

| Gate                                                      | Result  | Environment and evidence                                                                                   |
| --------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                          | PASS    | Local clean dependency verification with pnpm 11.1.1                                                       |
| `pnpm test:unit`                                          | PASS    | Desktop 57; server 2107 passed and 2 skipped; web 405                                                      |
| `pnpm lint`                                               | PASS    | 0 errors and 597 warnings, within the 600-warning budget                                                   |
| `pnpm lint:budget`                                        | PASS    | Warning budget enforced                                                                                    |
| `pnpm typecheck`                                          | PASS    | All workspaces after shared build                                                                          |
| `pnpm build`                                              | PASS    | Shared, server, web, CLI, MCP, and desktop outputs                                                         |
| `pnpm qa:mantine`                                         | PASS    | Mantine adoption and bundle budgets                                                                        |
| `pnpm test:e2e`                                           | PASS    | 34/34 across Chromium, mobile Chromium, and mobile WebKit after #829                                       |
| `pnpm audit`                                              | PASS    | No known production vulnerabilities                                                                        |
| `pnpm smoke:cli-mcp`                                      | PARTIAL | CLI/MCP build and metadata passed; live write skipped because no test API key was supplied                 |
| `pnpm desktop:package:mac:unsigned`                       | PASS    | ARM64 DMG and ZIP mounted/expanded as 5.2.2; main bundle imports Electron and has no installer-shim marker |
| `pnpm validate:release -- --version 5.2.2`                | PASS    | Version, package, build output, script, and required-doc validation                                        |
| `pnpm validate:release -- --version 5.2.2 --docker-build` | PASS    | Production image `veritas-kanban:validate-5.2.2` built with the Docker legacy builder                      |
| `pnpm validate:release -- --version 5.2.2 --github`       | PASS    | Local/origin tag and the published GitHub release verified                                                 |
| Pull request CI                                           | PASS    | Required build, unit, lint/typecheck, and security checks passed for all merged changes                    |
| Cross-model review                                        | NOT RUN | Explicitly waived by the release operator for this workstream                                              |

### Compatibility, Security, And Rollback

- v5.2.2 requires no schema migration from v5.2.1. Workspace package versions
  remain aligned, and existing v5 data contracts are unchanged.
- macOS 14+ on Apple Silicon remains the signed desktop target. Linux and
  Windows packages remain unsigned preview artifacts.
- File-backed writes retain serialized mutation, rollback, recovery, stable
  activity ordering, and retention behavior covered by the server suite.
- `pnpm audit` and GitHub security checks found no known production dependency
  vulnerabilities. Evidence contains no credentials or private advisory text.
- Because the v5.2.1 desktop bundle cannot launch reliably, users must replace
  it directly with the signed v5.2.2 app once published. Rollback remains app
  reinstall plus restoration of a pre-change backup when schema compatibility
  requires it.

### macOS Artifact And Distribution Inventory

| Evidence                            | State   | Notes                                                                                  |
| ----------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| Developer ID signing                | PASS    | Desktop Release run signs with Digital Meld's Developer ID Application identity        |
| Apple notarization                  | BLOCKED | `notarytool` returns HTTP 403 for a missing or expired team agreement on two attempts  |
| Signed DMG and ZIP                  | PENDING | No assets are attached to the v5.2.2 release                                           |
| SHA-256 sidecars and blockmaps      | PENDING | Publish and independently verify after notarization                                    |
| Gatekeeper, stapler, and `codesign` | PENDING | Run against downloaded release assets                                                  |
| Clean signed install and launch     | PENDING | Verify one process/window, onboarding, close/reopen, quit, update check, and VoiceOver |
| Homebrew cask                       | PENDING | Update only after the signed ZIP exists and its SHA-256 is verified                    |

The release body accurately states that macOS installation is not yet ready.
Do not substitute the locally generated unsigned artifacts for public release
assets or the Homebrew cask.

### Documentation Freshness And Known Limits

The v5.2.2 sweep inspected `README.md`, `CHANGELOG.md`, `AGENTS.md`,
`docs/FEATURES.md`, release notes, compatibility/rollback policy, install/admin
guide, GA checklist, desktop release guide, visual tour, this evidence packet,
and documentation-freshness SOP. User-visible release behavior was already
updated by the implementation and release PRs. The freshness SOP still matches
the workflow and required no behavioral edit.

Open follow-ups:

- #809: publish, verify, install, and exercise the signed/notarized assets.
- #816: complete the post-fix native audit and close the Apple-design tracker.
- #830: replace pending artifact rows with sizes, SHA-256 values, workflow
  evidence, installed-launch results, updater evidence, and Homebrew validation.
- #796: retain the non-sensitive external follow-up without exposing private
  advisory content.

### Release Decision

The v5.2.2 source and web/server/CLI/MCP changes pass the required release
gates. The macOS distribution is not approved for installation until #809 is
complete. The public release warning, open issues, and this packet all reflect
that limitation.

## v5.0.0 Retained Release Evidence

Retained evidence for the published v5.0.0 release and the v5 follow-up
issues:

- #644 completed release evidence packet
- #646 full-load and mobile/PWA evidence
- #649 signed update and rollback evidence

Do not paste secrets, tokens, private keys, raw chat/task content, or
unredacted local private paths into this packet.

## Candidate Identity

| Field                 | Value                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Candidate label       | v5.0.0 stable                                                                                               |
| Release version       | 5.0.0                                                                                                       |
| Git tag               | `v5.0.0`                                                                                                    |
| Commit SHA            | `3380acff8a196833aa06a4ff499a74e789d9cbba`                                                                  |
| GitHub release URL    | <https://github.com/BradGroux/veritas-kanban/releases/tag/v5.0.0>                                           |
| Desktop Release run   | <https://github.com/BradGroux/veritas-kanban/actions/runs/27084849504>                                      |
| Desktop Artifacts run | Not used for final signed assets; Desktop Release run produced and uploaded the signed/notarized artifacts. |
| CI run                | <https://github.com/BradGroux/veritas-kanban/actions/runs/27205274105>                                      |
| Evidence owner        | Brad Groux                                                                                                  |
| Review date           | 2026-06-09                                                                                                  |

Version checks:

- [x] `package.json` version: 5.0.0
- [x] `shared/package.json` version: 5.0.0
- [x] `server/package.json` version: 5.0.0
- [x] `web/package.json` version: 5.0.0
- [x] `cli/package.json` version: 5.0.0
- [x] `mcp/package.json` version: 5.0.0
- [x] `desktop/package.json` version: 5.0.0
- [x] `GET /api/health.version`: 5.0.0 from an isolated local server health check
- [x] `vk --version`: 5.0.0
- [x] MCP package/version output: package version 5.0.0; stdio server starts from `mcp/dist/index.js`

## Release Validation

| Gate                                | Result  | Evidence                                                                                           |
| ----------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`    | PASS    | GitHub runs 27084849504 and 27205274105                                                            |
| `pnpm typecheck`                    | PASS    | Local command on 2026-06-09                                                                        |
| `pnpm lint:budget`                  | PASS    | Local command on 2026-06-09, 0 errors, 598 warnings, budget 600                                    |
| `pnpm test:unit`                    | PASS    | Local command on 2026-06-09, desktop 57 tests, server 1885 tests, web 326 tests                    |
| `pnpm build`                        | PASS    | Desktop Release run 27084849504 and local release validation build outputs                         |
| `pnpm validate:release`             | PASS    | Local command on 2026-06-09                                                                        |
| `pnpm validate:release -- --github` | PASS    | `pnpm validate:release -- --github --repo BradGroux/veritas-kanban` on 2026-06-09                  |
| `pnpm smoke:cli-mcp`                | Covered | CLI version and MCP stdio startup checked; full smoke remains part of reusable candidate checklist |
| `pnpm desktop:package:mac:unsigned` | Covered | Signed Desktop Release run 27084849504 supersedes unsigned packaging for GA                        |
| `pnpm test:load`                    | PASS    | Scheduled QA full-profile run 27205274105                                                          |

Local verification commands retained for this packet:

```bash
pnpm exec playwright test e2e/health.spec.ts e2e/prompt-registry.spec.ts e2e/mantine-qa-gate.spec.ts --project=chromium
pnpm exec playwright test e2e/mobile-responsive.spec.ts e2e/pwa-offline.spec.ts --project=mobile-chromium --project=mobile-webkit
pnpm typecheck
pnpm lint:budget
pnpm test:unit
pnpm validate:release -- --github --repo BradGroux/veritas-kanban
```

## macOS Artifact Inventory

Stable v5.0.0 macOS artifacts were produced by Desktop Release run
27084849504 and published under the v5.0.0 release.

| Asset                  | URL                                                                                                                | SHA-256                                                            | Notes                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| signed DMG             | <https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.dmg>          | `f3d0c3a70b66c27c27db527b2cdeb8ac86f174630c951a429eeb59b4080bf0ae` | Downloaded and checksum-matched locally on 2026-06-09.         |
| signed ZIP             | <https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.zip>          | `bfd1e57fc99b4468f9fd97418c2aa57b51a1e3087966539c60a75c848c595cb1` | Downloaded and checksum-matched locally on 2026-06-09.         |
| DMG blockmap           | <https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.dmg.blockmap> | `0d10746c0703e1ac1409b9a370ed2bd8195dc25fc8f9e1384f909140f5e00a0e` | Release asset digest.                                          |
| ZIP blockmap           | <https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.zip.blockmap> | `2eb8b8a93cca84f1579736ce06bf5107edd688c9d941ce83ba3876982ec52d09` | Release asset digest.                                          |
| stable update metadata | <https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/latest-mac.yml>                              | `535cd6da5e95dff8dcf869fa2b236a2b1ddcc4dff118f325b41265cb96f14db1` | Points to `Veritas-Kanban-5.0.0-mac-arm64.zip` as update path. |
| source archive         | <https://github.com/BradGroux/veritas-kanban/archive/refs/tags/v5.0.0.zip>                                         | GitHub generated                                                   | Tag source archive.                                            |
| changelog entry        | `CHANGELOG.md` -> `## [5.0.0]`                                                                                     | n/a                                                                | Verified by `pnpm validate:release`.                           |

Notarization and Gatekeeper:

- [x] `codesign --verify --deep --strict --verbose=2` passed for the unpacked release ZIP app.
- [x] `codesign -dv --verbose=4` showed Developer ID Application: Digital Meld, Inc. (RLBHD62MPW), TeamIdentifier `RLBHD62MPW`, hardened runtime flag, timestamp 2026-06-07 01:27:02.
- [x] `xcrun stapler validate` passed for the unpacked app.
- [x] `spctl --assess --type execute --verbose=4` accepted the unpacked app with source `Notarized Developer ID`.
- [x] `xcrun stapler validate` passed for the DMG.
- [x] `spctl --assess --type open --context context:primary-signature --verbose=4` accepted the DMG with source `Notarized Developer ID`.
- [ ] Clean Mac install screenshot or recording: not captured in this packet.
- [x] First-run profile/workspace data path verified by desktop path unit tests and package metadata; manual signed GUI launch was attempted with an isolated temp profile but did not expose `/api/health` before timeout in this environment.

## Signed Update And Rollback Drill

This section satisfies the retained evidence target for #649 while recording
the limitation that no prior signed v4 baseline asset exists for a true native
updater from v4.3.2 to v5.0.0.

| Step                                     | Result     | Evidence                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install signed baseline build            | PARTIAL    | v5.0.0 signed ZIP and DMG downloaded, checksum-matched, notarization/Gatekeeper passed. A true v4 signed baseline install is blocked because v4.3.2 has no attached release assets.                                                                                         |
| Launch and verify local server health    | PARTIAL    | Built server health returned version 5.0.0 from isolated data dir. Signed GUI launch through LaunchServices was attempted with isolated `HOME`, profile, workspace, and ports; the app process started but did not expose health before timeout and wrote no stdout/stderr. |
| Publish or expose higher RC update       | NOT RUN    | No higher signed candidate exists after v5.0.0.                                                                                                                                                                                                                             |
| Check for update from native menu        | NOT RUN    | Requires a lower signed baseline plus higher signed candidate.                                                                                                                                                                                                              |
| Download update                          | NOT RUN    | Requires a lower signed baseline plus higher signed candidate.                                                                                                                                                                                                              |
| Install update                           | NOT RUN    | Requires a lower signed baseline plus higher signed candidate.                                                                                                                                                                                                              |
| Verify updated app/server/web versions   | COVERED    | All workspace package versions 5.0.0; release validator confirms aligned release docs/assets; `/api/health.version` returned 5.0.0 from isolated server.                                                                                                                    |
| Reinstall previous signed DMG            | BLOCKED    | No previous signed DMG asset is attached to the v4.3.2 release.                                                                                                                                                                                                             |
| Verify rollback behavior                 | DOCUMENTED | `docs/V5-COMPATIBILITY-AND-RELEASE-POLICY.md` and `docs/V5-UPGRADE-INSTALL-ADMIN-GUIDE.md` document reinstall plus backup restore as the supported rollback path.                                                                                                           |
| Restore backup if schema is incompatible | COVERED    | Server unit suite includes backup/recovery coverage; API reference and admin guide document migration recovery and restore-backup endpoints.                                                                                                                                |
| Record admin recovery notes              | COMPLETE   | See rollback notes below and the admin guide.                                                                                                                                                                                                                               |

Rollback notes:

```text
For v5.0.0 GA, updater metadata points to v5.0.0 arm64 ZIP/DMG artifacts.
If a signed macOS build must be rolled back, reinstall the previous signed app
artifact when one exists, then restore the pre-migration backup if the older app
cannot open a newer SQLite schema. The v4.3.2 release does not have attached
signed assets, so a native v4-to-v5 updater drill cannot be completed from
published release assets. Future v5 patch candidates should run the native
update drill from v5.0.0 to the patch candidate before publication.
```

## Migration, Backup, And Restore

| Gate                                     | Result     | Evidence                                                                                                                                |
| ---------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| v4 file-backed backup preserved          | COVERED    | `docs/V5-UPGRADE-INSTALL-ADMIN-GUIDE.md` requires dry-run and backup preservation before accepting migration.                           |
| SQLite migration dry-run                 | COVERED    | API reference documents `/api/v1/sqlite/migration/dry-run`; release validator confirms migration docs are present.                      |
| SQLite migration run                     | COVERED    | API reference documents `/api/v1/sqlite/migration/run`; release validator confirms migration docs are present.                          |
| Migration journal/report preserved       | COVERED    | API reference and compatibility policy require migration journal/report retention.                                                      |
| Board/task/search/workflow/chat verified | PASS       | Local Playwright mobile/desktop smoke and workspace unit tests passed on 2026-06-09.                                                    |
| Backup/export created                    | COVERED    | Server unit suite covers integrity backup behavior; API reference documents SQLite backup export.                                       |
| Restore/import verified                  | COVERED    | Server unit suite covers recovery behavior; API reference documents restore-backup and import verification endpoints.                   |
| Older app refuses newer SQLite schema    | DOCUMENTED | Compatibility policy defines `SQLITE_UNSUPPORTED_SCHEMA` behavior and directs admins to compatible app or pre-migration backup restore. |

Accepted migration risks:

```text
v5.0.0 does not promise destructive down migrations after SQLite migration.
Rollback is app reinstall plus backup restore when schema compatibility blocks
the older app. Preserve the pre-migration file-backed backup and migration
journal before accepting the migration.
```

## Load, Remote, Mobile, And PWA Evidence

This section satisfies the evidence target for #646 with Scheduled QA run
27205274105 and retained k6 artifact 7507319688.

Full load profile:

| Field                | Value                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target origin        | `http://127.0.0.1:3001` in GitHub Actions Scheduled QA                                                                                                    |
| Seed profile         | `V5_SEED_TASKS=120`, `V5_SEED_CHATS=12`, `V5_HTTP_VUS=20`, `V5_WS_VUS=30`, `V5_DURATION=45s`, `V5_WS_HOLD_MS=40000`                                       |
| k6 command           | Scheduled QA `load_profile=full`, scripts `smoke read-load write-load mixed-load ws-stress v5-remote-mix`                                                 |
| k6 output artifact   | <https://github.com/BradGroux/veritas-kanban/actions/runs/27205274105/artifacts/7507319688>                                                               |
| HTTP p95             | Max p95 across HTTP scripts: 23.454 ms (`v5-remote-mix`)                                                                                                  |
| HTTP error rate      | Max HTTP failure/custom error rate: 0.247% (`mixed-load`, below 1% threshold)                                                                             |
| WebSocket error rate | 0% (`ws-stress`; `v5-remote-mix` WebSocket connect checks also passed 30/30)                                                                              |
| Known scale ceiling  | v5.0.0 supports heavy solo/local or small-team trusted-host use. Larger hosted or SaaS-style deployments need higher seed counts and longer soak windows. |

Remote/mobile smoke:

| Client               | Device/OS                                       | Browser version                        | Result | Evidence                                                                                                    |
| -------------------- | ----------------------------------------------- | -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Safari-class browser | Playwright `iPhone 13`                          | WebKit from local Playwright install   | PASS   | `pnpm exec playwright test e2e/mobile-responsive.spec.ts e2e/pwa-offline.spec.ts --project=mobile-webkit`   |
| Chrome-class browser | Playwright `Pixel 5`                            | Chromium from local Playwright install | PASS   | `pnpm exec playwright test e2e/mobile-responsive.spec.ts e2e/pwa-offline.spec.ts --project=mobile-chromium` |
| Installed PWA        | Browser PWA install metadata and service worker | Chromium and WebKit                    | PASS   | `e2e/pwa-offline.spec.ts` verifies manifest, static service worker, and offline shell warning.              |

PWA stale-client checks:

- [x] Static shell can load from cache: service worker static-shell test.
- [x] API data is not cached for offline replay: service worker excludes `api/`.
- [x] Offline writes are not queued: offline shell warns that task data and changes require the trusted server.
- [x] Stale client refresh blocks or refreshes before write: compatibility policy documents stale-client refresh behavior; mobile/PWA smoke exercises remote-safe shell behavior.
- [x] Same-origin `/api`, `/ws`, manifest, service worker, and static assets verified: PWA spec verifies manifest/service worker; k6 full profile run 27205274105 covers `/api` and `/ws`.

Known limits to include in release notes:

```text
Mobile/PWA v5.0.0 is responsive web plus installable static shell. It is not a
native offline app and does not queue writes offline. Remote access remains a
trusted-host scenario. Larger hosted deployments need additional load evidence
with higher seed counts and longer soak windows.
```

## Security And Diagnostics

| Gate                                     | Result  | Evidence                                                              |
| ---------------------------------------- | ------- | --------------------------------------------------------------------- |
| Security audit reviewed                  | COVERED | `docs/security.md` and v5 release docs retained by release validator. |
| Debug bundle redaction negative fixtures | COVERED | Workspace unit suite passed on 2026-06-09.                            |
| Scoped API token smoke                   | COVERED | Workspace unit suite passed on 2026-06-09.                            |
| Password-session boundary smoke          | COVERED | Playwright mobile/login smoke passed locally on 2026-06-09.           |
| WebSocket auth/reconnect smoke           | PASS    | Scheduled QA full k6 run 27205274105.                                 |
| Support bundle contains no private data  | COVERED | Workspace unit suite passed on 2026-06-09.                            |

Security release notes:

```text
No secrets or private app data are retained in this packet. Release evidence
uses GitHub run URLs, release asset digests, sanitized local command summaries,
and temp-profile checks only.
```

## Visual Documentation And Media

The checked-in dummy-data docs media lives in
[v5 Visual Tour](V5-VISUAL-TOUR.md).

| Surface                   | Docs asset                                 | Candidate proof                                              |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Desktop board             | `docs/assets/v5/v5-board-overview.png`     | Visual tour retained; local desktop QA route smoke passed.   |
| Board/workflow/audit GIF  | `docs/assets/v5/v5-board-to-workflow.gif`  | Visual tour retained.                                        |
| Task work view            | `docs/assets/v5/v5-task-work-view.png`     | Visual tour retained; local mobile task-detail smoke passed. |
| Maintenance Center        | `docs/assets/v5/v5-maintenance-center.png` | Visual tour retained.                                        |
| Mobile/PWA board          | `docs/assets/v5/v5-mobile-pwa-board.png`   | Visual tour retained; mobile Chromium/WebKit smoke passed.   |
| Mobile/PWA navigation GIF | `docs/assets/v5/v5-mobile-pwa-flow.gif`    | Visual tour retained; mobile navigation smoke passed.        |

Visual docs notes:

```text
The retained docs media is dummy-data documentation media. Local Playwright
smoke, not screenshots, is the release evidence for current mobile/desktop
rendering in this packet.
```

## Final Decision

| Question                                             | Answer                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Are all critical/high v5 release blockers closed?    | Yes; #649 update-drill limits are documented because no prior signed baseline asset exists. |
| Are all deferred items linked as post-GA issues?     | Yes; update drill limitations are recorded in #649 evidence.                                |
| Are user-visible limits documented in release notes? | Yes; release notes and upgrade guide document PWA/offline and rollback limits.              |
| Is this candidate approved for publication?          | Already published as v5.0.0; retained evidence is being backfilled for release hygiene.     |

Decision notes:

```text
v5.0.0 is already published. This packet backfills durable release evidence and
records two important limits: native updater drill cannot be completed without a
prior signed baseline asset, and larger hosted deployments need additional load
evidence beyond the v5.0.0 full Scheduled QA profile.
```
