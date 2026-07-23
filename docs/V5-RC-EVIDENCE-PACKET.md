# v5 Release Evidence Packets

## v5.2.5 Release Evidence Packet

This section records the desktop existing-data upgrade fix, migration runbook,
release validation, signed artifacts, and Homebrew publication for v5.2.5.

### Release scope

| Field                  | Value                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Release version        | 5.2.5                                                                                                 |
| Release issue          | <https://github.com/BradGroux/veritas-kanban/issues/914>                                              |
| Desktop setup issue    | <https://github.com/BradGroux/veritas-kanban/issues/901>                                              |
| Desktop setup PR       | <https://github.com/BradGroux/veritas-kanban/pull/902>                                                |
| Migration docs issue   | <https://github.com/BradGroux/veritas-kanban/issues/899>                                              |
| Migration docs PR      | <https://github.com/BradGroux/veritas-kanban/pull/900>                                                |
| Dependency audit issue | <https://github.com/BradGroux/veritas-kanban/issues/903>                                              |
| Dependency audit PR    | <https://github.com/BradGroux/veritas-kanban/pull/908>                                                |
| Release PR             | <https://github.com/BradGroux/veritas-kanban/pull/922>                                                |
| Release commit         | `55e621d14756799ee9b2d1ab4467013186776ae9`                                                            |
| Annotated tag          | `v5.2.5`; object `c1390f24ad892a2149118645965d7ab3f7691f17`                                           |
| GitHub release         | <https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.5>                                     |
| Desktop Release run    | <https://github.com/BradGroux/veritas-kanban/actions/runs/30019865167>                                |
| Homebrew cask PR       | <https://github.com/BradGroux/homebrew-tap/pull/33>; merge `d05cb0ad567eb1df239a2e99d8095398a8d46c37` |
| Release state          | Published, signed/notarized, independently verified, and available through Homebrew                   |
| Release branch         | `release/v5.2.5-914`                                                                                  |
| Evidence date          | 2026-07-23                                                                                            |

### Upgrade contract

- A populated desktop database is never treated as a fresh board. Setup offers
  **Use Existing Data**, displays representative counts, and secures the
  database without replacing board rows or imported owner metadata.
- Startup, setup, password, recovery, loading, and login surfaces remain
  draggable while interactive controls remain clickable.
- Operators whose records already exist in the desktop SQLite workspace do not
  rerun file migration and do not choose backup recovery.
- Legacy file-backed data migrates into a fresh staging database with the
  desktop app stopped. The authoritative desktop database is installed only
  after every writer closes.
- Governed export-bundle import is an explicit Maintenance operation with
  destructive replacement confirmation. The onboarding **Restore Backup** card
  remains picker/preflight only in v5.2.5.

### Pre-publication gates

| Gate                                             | Result  | Evidence                                                                                                                                                           |
| ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check:pnpm-settings`                       | PASS    | Node 26.5.0, pnpm 11.1.1, and the repository package-manager contract agree                                                                                        |
| `pnpm audit --prod --audit-level=high`           | PASS    | Zero high or critical advisories; one low and one moderate advisory remain documented below                                                                        |
| `pnpm lint` and `pnpm lint:budget`               | PASS    | Zero errors; 595 warnings remain within the 600-warning budget                                                                                                     |
| `pnpm qa:mantine`                                | PASS    | Mantine migration and bundle-size budgets passed                                                                                                                   |
| `pnpm typecheck` and `pnpm build`                | PASS    | Shared, server, web, CLI, MCP, and desktop workspaces passed                                                                                                       |
| `pnpm test:unit`                                 | PASS    | All workspace suites passed                                                                                                                                        |
| Focused existing-data and auth regression suites | PASS    | Web 12/12; server 42/42; desktop 61/61                                                                                                                             |
| `pnpm desktop:check:electron-artifacts`          | PASS    | Main and preload output preserved Electron runtime imports and rejected installer-shim patterns                                                                    |
| `pnpm smoke:cli-mcp`                             | PARTIAL | Build and version checks passed; live read/write smoke skipped because no test API key was set                                                                     |
| `pnpm test:e2e`                                  | PASS    | 36/36 across Chromium, mobile Chromium, and mobile WebKit using an isolated temporary data store                                                                   |
| `pnpm desktop:smoke:mac:local`                   | PASS    | ARM64 unpacked app and isolated production staging passed                                                                                                          |
| `pnpm desktop:package:mac:unsigned`              | PASS    | v5.2.5 ARM64 DMG, ZIP, blockmaps, update metadata, and app bundle produced                                                                                         |
| `pnpm validate:release -- --version 5.2.5`       | PASS    | Versions, scripts, docs, and local build artifacts passed                                                                                                          |
| Isolated populated SQLite packaged upgrade       | PASS    | Unsigned app selected **Use Existing Data**, showed 2/3/1/1/1 counts, and preserved every count plus migrated owner and task-owner metadata through password setup |
| Packaged drag-region and control contract        | PASS    | Electron reported `drag` for the setup surface and `no-drag` for controls; Agent Ready remained clickable and selected                                             |
| Independent standards and specification review   | PASS    | Two separate reviewers found the publication-proof and MCP-version gaps; both were corrected before commit                                                         |
| Repository Copilot review                        | PASS    | Reviewed all 19 changed files on PR #922; its two documentation consistency findings were corrected before merge                                                   |

The residual production advisories are `body-parser` low-severity
`GHSA-v422-hmwv-36x6` and `@hono/node-server` moderate-severity
`GHSA-frvp-7c67-39w9`. The latter applies to Windows static-file serving in a
transitive MCP dependency; the Veritas MCP package uses stdio and the supported
desktop target is macOS. Neither advisory crosses the release gate's
high/critical threshold. Both remain visible rather than being hidden behind an
unsafe major-version override.

Direct Claude CLI review was unavailable because Claude Code had no
authenticated session and GitHub Copilot CLI returned no quota. The repository
Copilot reviewer supplied the available external review gate on PR #922.

### Publication evidence

The annotated tag peels to release commit
`55e621d14756799ee9b2d1ab4467013186776ae9`. Desktop Release run
[#30019865167](https://github.com/BradGroux/veritas-kanban/actions/runs/30019865167)
completed successfully in 10m38s and published all seven expected assets.
Independent downloads matched both the release-attached checksum files and the
GitHub asset digests:

| Artifact                                      | Bytes       | SHA-256                                                            |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `Veritas-Kanban-5.2.5-mac-arm64.dmg`          | 268,133,388 | `056d448ad20adf03fe0a32ac0dc12bf3e4b384c1b7a6c8419edffc803322f688` |
| `Veritas-Kanban-5.2.5-mac-arm64.dmg.blockmap` | 279,312     | `88ee282ac0980231c92097d00ac69c19423df889bf1a865bbb11803d401d75bf` |
| `Veritas-Kanban-5.2.5-mac-arm64.dmg.sha256`   | 101         | `59892a48108017cf8d3c7217f908e0f4638e00e86ce457e0f876ef82f488dbe2` |
| `Veritas-Kanban-5.2.5-mac-arm64.zip`          | 271,243,007 | `3f1816de7ae46d5e0541209f8acd65ffa32a47bd5caeedd9546358557e66fced` |
| `Veritas-Kanban-5.2.5-mac-arm64.zip.blockmap` | 279,514     | `ecf30e86035a9b2e531f8632401bf28033019c82215b17cb32ee321dd44f456f` |
| `Veritas-Kanban-5.2.5-mac-arm64.zip.sha256`   | 101         | `7399226b582c5e776d8ab5096dd94a20453309b053f8395bb2d9288ff1bbfb93` |
| `latest-mac.yml`                              | 530         | `1a88552cc0887e03acd25db3d6af30bb764b05892a4a0d8fc2ba94acec73b94e` |

`latest-mac.yml` reports version 5.2.5, names the published ZIP and DMG, and
matches their byte sizes and SHA-512 values. The extracted ZIP app and DMG both
pass strict code-signing verification, Gatekeeper acceptance as Notarized
Developer ID, and stapled-ticket validation. The app is signed by Developer ID
Application: Digital Meld, Inc. (`RLBHD62MPW`) with hardened runtime.

The downloaded signed app launched under an isolated profile and returned
version 5.2.5 from `/api/health`. The setup path rendered, **Agent Ready**
remained clickable, and dragging the non-control setup header physically moved
the window. It then quit cleanly through the native app menu.

Homebrew issue
[#32](https://github.com/BradGroux/homebrew-tap/issues/32) and PR
[#33](https://github.com/BradGroux/homebrew-tap/pull/33) publish the ZIP checksum
above. The registered tap passed `brew style --cask`,
`brew audit --cask --strict --online`, `brew install --cask --dry-run`, and
`brew livecheck`. A stopped-app laptop upgrade from 5.2.4 to 5.2.5 preserved a
host-specific empty board with `PRAGMA quick_check` returning `ok` and matching
0/0/0/0/0 task, Squad Chat, telemetry, workflow-definition, and workflow-run
counts. The pre-upgrade snapshot is retained under the desktop workspace's
`backups/pre-upgrade-20260723-103736` directory. After launch, port 3001 was
owned by the packaged application and bundled `Resources/server/dist/index.js`,
and `/api/health` returned 5.2.5.

Source merge, GitHub release publication, signed runtime verification, Homebrew
availability, and a host-specific data check are separate gates; none
substitutes for another.

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
After the team accepted the updated Apple agreement, Desktop Release attempt 4
signed, notarized, stapled, and published the macOS artifacts. Independent
downloads matched GitHub digests and attached sidecars. The signed ZIP app
launched with an isolated profile, reported version 5.2.2, completed a current
version update check, reopened cleanly, and quit without remaining processes.
The Homebrew cask update passed its registered-tap gates and merged in #23.

| Field               | Value                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Release version     | 5.2.2                                                                                       |
| Git tag             | Annotated `v5.2.2`; object `81ce4928e457c91a16a20827ddac1a94fb8f4170`                       |
| Release commit      | `4b84eccd1bf827c842e93a82afd0240e6855b3df`                                                  |
| GitHub release      | <https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.2>                           |
| Desktop Release run | <https://github.com/BradGroux/veritas-kanban/actions/runs/29213420721>                      |
| Release state       | Published, signed/notarized, independently verified, and available through Homebrew         |
| Evidence date       | 2026-07-12                                                                                  |
| Toolchain           | macOS 26.5.1; Node 26.5.0; pnpm 11.1.1; Playwright Chromium and WebKit; Docker legacy build |

### Issue And Pull Request Traceability

| Issue | Priority     | Outcome                                                                                               | Pull request    | State               |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------- | --------------- | ------------------- |
| #809  | Critical     | Externalize Electron runtime APIs, reject emitted installer shims, and restore a single native window | #817            | Acceptance complete |
| #810  | High         | Make compact Settings navigation visible and stack dense controls                                     | #820            | Closed              |
| #811  | High         | Prevent mobile navigation collisions and restore Board Chat                                           | #821            | Closed              |
| #812  | High         | Restore keyboard movement, ordering, announcements, rollback, and focus                               | #818            | Closed              |
| #813  | Medium       | Add a deliberate compact Scoring Profiles master-detail flow                                          | #826            | Closed              |
| #814  | Medium       | Remove layout-driven dashboard animation and honor reduced motion                                     | #822            | Closed              |
| #815  | Medium       | Honor transparency/contrast preferences and dismiss stale tooltips                                    | #819            | Closed              |
| #816  | Tracker      | Apple-design audit coverage and final native follow-up                                                | #817-#822, #826 | Acceptance complete |
| #828  | Release QA   | Repair stale release E2E selectors without changing product behavior                                  | #829            | Closed              |
| #830  | Release docs | Preserve this evidence and the v5.2.2 freshness sweep                                                 | this PR         | Acceptance complete |

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
bindings, and adds packaged-launch coverage. Development, unsigned, and
downloaded signed v5.2.2 builds each launched one native application window
with no installer recursion. Signed runtime acceptance covered setup,
server/renderer readiness, Keychain status, keyboard focus, native menus,
window chrome, current-version update check, clean quit, reopen, and a second
clean quit with no remaining process or listening port.

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

| Asset                                         |              Size | SHA-256                                                            | Verification                                                                    |
| --------------------------------------------- | ----------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `Veritas-Kanban-5.2.2-mac-arm64.dmg`          | 266,283,327 bytes | `358acaa501827fca7e59d67a98b261b07fa9d5e01e3acae9755e8f7c010b86eb` | GitHub digest, sidecar, stapler, Gatekeeper, mounted bundle 5.2.2               |
| `Veritas-Kanban-5.2.2-mac-arm64.zip`          | 269,456,458 bytes | `3f85d864a78251c8e1bb94f9914dcab0ce9795cf5a45f64fffdf33337cfb3d4a` | GitHub digest, sidecar, extracted signature, stapler, Gatekeeper, signed launch |
| `Veritas-Kanban-5.2.2-mac-arm64.dmg.blockmap` |     276,119 bytes | `c145880aef635f2d6f5153a484db9aa901040abb552545d5890abf391be19085` | GitHub digest and independent hash                                              |
| `Veritas-Kanban-5.2.2-mac-arm64.zip.blockmap` |     284,294 bytes | `f33dd971199454962d32d3b7bf737b5b19bb828302433e1d41e77847aef8443f` | GitHub digest and independent hash                                              |
| `latest-mac.yml`                              |         530 bytes | `d2dc95378935835d2ceaa2ff4d298edf41adf2bb73a58b1b4a83eac72c7ab641` | Points to the 5.2.2 ZIP and DMG with matching sizes and SHA-512 values          |

The app signature identifies Developer ID Application: Digital Meld, Inc.
(`RLBHD62MPW`), includes hardened runtime and a timestamp, and satisfies its
designated requirement. Stapler and Gatekeeper accept both the DMG and the
extracted ZIP app as `Notarized Developer ID`.

The signed app launched directly from the downloaded ZIP using an isolated
profile and ports. `/api/health` returned 5.2.2; setup showed server, renderer,
Keychain, and SQLite readiness; keyboard focus and native menus were operable;
the updater reported 5.2.2 as current; quit, reopen, and quit completed cleanly.
With VoiceOver active, keyboard navigation moved through the AX hierarchy to
the correctly named `Copy Diagnostics` control; VoiceOver was then disabled and
the isolated app quit with no remaining process or port.

Homebrew tap PR <https://github.com/BradGroux/homebrew-tap/pull/23> merged at
`292f340a894ea86079abba9b54cf71f1034ae06c`. Registered token
`bradgroux/tap/veritas-kanban` passed style, strict online audit, dry-run
install, and livecheck (`5.2.2 ==> 5.2.2`).

### Documentation Freshness And Known Limits

The v5.2.2 sweep inspected `README.md`, `CHANGELOG.md`, `AGENTS.md`,
`docs/FEATURES.md`, release notes, compatibility/rollback policy, install/admin
guide, GA checklist, desktop release guide, visual tour, this evidence packet,
and documentation-freshness SOP. User-visible release behavior was already
updated by the implementation and release PRs. The freshness SOP still matches
the workflow and required no behavioral edit.

Open follow-ups:

- #796: retain the non-sensitive external follow-up without exposing private
  advisory content.

### Release Decision

v5.2.2 passes the required source, web, server, CLI, MCP, desktop, signing,
notarization, artifact, signed-runtime, update, and Homebrew gates. The macOS
distribution is approved for installation. The annotated tag peels to release
commit `4b84eccd1bf827c842e93a82afd0240e6855b3df`; converting the tag object did
not change source contents or published assets.

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
