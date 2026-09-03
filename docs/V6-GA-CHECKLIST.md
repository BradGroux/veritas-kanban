# Veritas Kanban v6 GA Checklist

This checklist contains the active stable-release gate for Veritas Kanban
6.1.5 and retains the completed 6.1.4, 6.1.3, 6.1.2, 6.1.1, 6.1.0, and 6.0.2 evidence below.
Command results, platform details, workflow links, limitations, and artifact hashes belong in
[v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md).

Documentation freshness: 2026-09-03 for the verified Veritas Kanban 6.1.5 stable release.

## 6.1.5 Release Gate

- [x] Starting issues #1295-#1302 have an evidence-backed completed disposition through focused merged work.
- [x] Starting dependency PRs #1303-#1306 were reviewed and superseded by focused merged PRs #1311-#1313.
- [x] Settings tracker #1297 and task-workspace tracker #1299 were completed through linked, independently reviewed child issues and PRs.
- [x] Public documentation excludes internal prompts, raw audits, handoffs, and working notes, and CI classifies every tracked Markdown file (#1350, #1353).
- [x] The integrated release builds all seven workspaces, packages a launchable macOS arm64 app, and exposes the completed Settings and task-workspace UI.
- [x] Current desktop and mobile screenshots, GIFs, social previews, and demo video were regenerated from an isolated public-safe 6.1.5 workspace with `pnpm docs:capture-media`.
- [x] The native About panel identifies the MIT license and Digital Meld copyright holder, uses concise build metadata, and reports the current 6.1.5 application version.
- [x] Release PR [#1357](https://github.com/BradGroux/veritas-kanban/pull/1357) passed the authoritative `ci:full` matrix and merged as `4d27bfcff0c881c2205d36654cb6b6f558bb1cba` with all maintained package metadata at 6.1.5.
- [x] Annotated tag `v6.1.5` peels to the release merge, and the live GitHub release body exactly matches `docs/releases/v6.1.5.md`.
- [x] Desktop Release run [33723400659](https://github.com/BradGroux/veritas-kanban/actions/runs/33723400659) published independently verified signed/notarized 6.1.5 DMG and ZIP assets, blockmaps, checksum sidecars, and updater metadata.
- [x] Homebrew tap PRs [#57](https://github.com/BradGroux/homebrew-tap/pull/57) and [#59](https://github.com/BradGroux/homebrew-tap/pull/59) publish cask version 6.1.5, the verified ZIP checksum, and the artifact's macOS Ventura minimum; strict online audit, fetch, livecheck, and dry-run installation pass.

## Historical 6.1.4 Completed Release Gate

- [x] Release tracker [#1307](https://github.com/BradGroux/veritas-kanban/issues/1307) and publication-boundary fix [#1308](https://github.com/BradGroux/veritas-kanban/pull/1308) are merged with focused security regression evidence.
- [x] Root, shared, server, web, CLI, MCP, desktop, and lockfile package metadata are exactly 6.1.4.
- [x] The production dependency audit passes the high-severity threshold with `fast-uri` 3.1.6, and 6.1.4 adds no API or database schema change.
- [x] Release PR [#1309](https://github.com/BradGroux/veritas-kanban/pull/1309) passed the full release matrix and merged as `36b5529050aeb5cabbbefa8ac90e43f5f02e04d5`.
- [x] Annotated tag `v6.1.4` peels to the release merge, and the live GitHub release body matches `docs/releases/v6.1.4.md`.
- [x] Desktop Release run [33672624733](https://github.com/BradGroux/veritas-kanban/actions/runs/33672624733) published the signed/notarized macOS DMG and ZIP, blockmaps, checksum sidecars, and updater metadata.
- [x] Homebrew tap PR [#55](https://github.com/BradGroux/homebrew-tap/pull/55) merged with cask version 6.1.4 and the verified published ZIP checksum.
- [x] The coordinated security fix is included in every supported 6.1.4 distribution surface; advisory disclosure remains owner-controlled.

## Historical 6.1.3 Completed Release Gate

- [x] Release tracker #1262 and its implementation dependencies are merged or
      have an evidence-backed disposition; only the final release matrix and
      publication gates remain open.
- [x] Root, shared, server, web, CLI, MCP, and desktop manifests are 6.1.3.
- [x] README, canonical instructions, API reference, compatibility policy,
      upgrade guide, release notes, canonical GitHub body, freshness record,
      and changelog are synchronized for 6.1.3.
- [x] Governed artifacts, previews, file provenance and execution, Run Access,
      recurring automation, accessibility, native menus, motion, SQLite
      migration 34, and reliability follow-ups are represented in release docs.
- [x] The pre-release security audit has no open Dependabot or secret-scanning
      alerts. The reviewed CodeQL metadata-hash false positive is dismissed and
      default-branch CodeQL has zero open alerts.
- [x] Packaged authentication, secondary-action, macOS menu, motion, compact
      width, keyboard, reduced-motion, and accessibility smoke evidence is
      recorded for #1256-#1260.
- [x] One clean final candidate passes the complete Node-floor and current-Node
      release matrix with exact counts, skips, retries, image size, and
      limitations recorded in the evidence packet.
- [x] The release PR merges and its exact merge is published as annotated
      `v6.1.3` with a live body matching `docs/releases/v6.1.3.md`.
- [x] Signed/notarized macOS assets, updater metadata, installed-app readiness,
      and the live Homebrew cask are verified.
- [x] Every publication readback required before closing release tracker #1262
      has passed; close the tracker after this evidence update merges.

## Historical 6.1.2 Completed Release Gate

- [x] Audit issues #1162-#1173 are closed through merged, evidence-linked pull
      requests and the single final regression milestone.
- [x] Root, shared, server, web, CLI, MCP, and desktop manifests are 6.1.2.
- [x] README, canonical instructions, API reference, compatibility policy,
      upgrade guide, release notes, canonical GitHub body, freshness record, and
      changelog are synchronized for 6.1.2.
- [x] Runtime paths, storage repositories, provider adapters and lifecycle,
      credential-aware frontend requests, immutable actions, continuous
      scanning, critical coverage, dependency cleanup, lint ratchets, and the
      production Docker contract are represented in release documentation.
- [x] Independent and cross-model review remain optional; they are not part of
      the default delivery or release gate.
- [x] The coordinated security fix is integrated, released in supported
      artifacts, and published through the approved repository advisory.
- [x] One clean final candidate passes the complete Node-floor and current-Node
      verification matrix with exact counts, skips, retries, image size, and
      limitations recorded in the evidence packet.
- [x] The release PR merges and its exact merge is published as annotated
      `v6.1.2` with a live body matching `docs/releases/v6.1.2.md`.
- [x] Signed/notarized macOS assets, updater metadata, installed-app readiness,
      the live Homebrew cask, and the advisory disposition are verified.
- [x] Every publication readback required before closing release tracker #1174
      has passed; close the tracker after this evidence update merges.

## Historical 6.1.1 Completed Release Gate

- [x] Issue #1153 and pull requests #1148, #1149, #1150, #1154, and #1155
      received an evidence-backed maintainer disposition.
- [x] Long Task Detail content is constrained and scrollable, with Chromium
      layout, overflow, and wheel-input regression coverage (#1153, #1154).
- [x] Dependency updates were audited for runtime compatibility, peer ranges,
      advisories, lockfile integrity, tests, builds, and desktop packaging;
      jsdom 30 was rejected rather than weakening the Node.js floor (#1148,
      #1149, #1150, #1155).
- [x] Root, shared, server, web, CLI, MCP, and desktop manifests are 6.1.1.
- [x] README, API reference, compatibility policy, upgrade guide, release
      notes, canonical GitHub release body, and changelog agree on 6.1.1.
- [x] Frozen install, production and full audits, lint and warning budget,
      typecheck, build, workspace tests, Playwright, Mantine QA, CLI/MCP smoke,
      desktop checks, and release validators pass on the consolidated candidate.
- [x] Independent review is owner-directed and is not part of the active
      6.1.1 release gate; exact local and CI evidence carries the release
      decision.
- [x] The release PR merges and the exact merge is published as annotated
      `v6.1.1` with a live body matching `docs/releases/v6.1.1.md`.
- [x] Signed/notarized macOS assets, updater metadata, independent installed-app
      readiness, and the Homebrew cask are published and verified.

## Historical 6.1.0 Completed Release Gate

- [x] Roadmap issues #855, #864, #865, #866, #867, #868, #871, #872, #873,
      #876, and #879 are closed through merged pull requests.
- [x] Root, shared, server, web, CLI, MCP, and desktop manifests are 6.1.0.
- [x] README, canonical agent instructions, API/MCP references, compatibility
      policy, upgrade guide, release notes, and changelog agree on 6.1.0.
- [x] The reviewed GitHub release body exists at `docs/releases/v6.1.0.md` and
      passes the full-width release-format gate.
- [x] Focused verification passed for each roadmap slice before merge.
- [x] The milestone workspace suite is green. `pnpm test:unit` completed
      successfully across every workspace on the consolidated candidate;
      server reported 3,234 passing and 5 skipped tests, web reported 469
      passing tests, and desktop reported 67 passing tests.
- [x] Required release-PR CI, production audit, lint, typecheck, build,
      compatibility smoke, and packaging gates pass on the reviewed candidate.
- [x] The release PR merges, annotated `v6.1.0` tag and GitHub release publish,
      and the desktop workflow uploads signed/notarized assets and updater
      metadata.
- [x] Independent download, signature, Gatekeeper, stapling, readiness,
      updater, GitHub release-body, and Homebrew cask verification pass.

## Final Release Validation Commands

Apply `ci:full` to the release pull request and keep it applied through the
final candidate synchronization. That single milestone runs the complete
workspace suite, critical-path coverage, unsigned desktop artifacts, and
Docker image contract. Run the following commands once from the clean 6.1.3
release candidate at the supported Node floor and current supported Node:

```bash
pnpm install --frozen-lockfile
pnpm check:pnpm-settings
pnpm check:security-artifacts
pnpm check:delivery-cadence
pnpm test:ci-scope
pnpm audit --prod --audit-level=high
pnpm audit:all
pnpm check:gitleaks
pnpm lint
pnpm lint:budget
pnpm lint:report
pnpm qa:mantine
pnpm typecheck
pnpm build
pnpm test
pnpm test:unit
pnpm test:e2e
pnpm smoke:cli-mcp
pnpm desktop:test
pnpm desktop:build
pnpm desktop:check:electron-artifacts
pnpm desktop:test:readiness
pnpm desktop:dev:fresh
pnpm desktop:smoke:mac:local
pnpm desktop:package:mac:unsigned
pnpm test:release-format
pnpm validate:release -- --version 6.1.3 --skip-build-output
pnpm validate:release -- --version 6.1.3 --docker-build
```

Mount and inspect the unsigned DMG and ZIP, exercise the visible native
single-instance/reopen/clean-close/quit lifecycle with an isolated profile, and
run the production image as its non-root user against an isolated volume.
Record health, auth, SQLite, static-web, canonical-path, backup, integrity,
image-size, and clean-shutdown evidence. The same candidate must pass these
gates at Node 22.22.1 and the current supported Node runtime.

## Distribution And Post-Publication

The 6.1.3 release is published and verified. Release PR #1293 merged as
`32ced60ebb1709f4a839dd80cc7bf067be1c5d9a`; annotated `v6.1.3`, the exact live
release body, signed/notarized assets, updater metadata, isolated downloaded-app
readiness, post-publication validation, and Homebrew PR #53 passed. The existing
Homebrew-installed 6.1.2 app was preserved during validation. Exact evidence is
recorded in the release candidate evidence packet.

## Historical 6.0.2 Source And Scope

- [x] The Buzz integration epic and every required child are closed through
      merged, focused pull requests.
- [x] The equal-footing harness epic and every required child are closed
      through merged, focused pull requests.
- [x] The release tracker lists the exact main baseline, release branch, release
      PR, deferred v6.x work, and no unresolved release blocker.
- [x] Root, shared, server, web, CLI, MCP, and desktop manifests are 6.0.2.
- [x] `AGENTS.md`, README badge, health, CLI, MCP, desktop bundle, artifact
      names, updater metadata, changelog, and current docs agree on 6.0.2.
- [x] The public API remains intentionally `v1`, with additive v6 contracts and
      tested CLI/MCP compatibility.

## 6.0.1 Stabilization

- [x] Task drawers, shared overlays, Archive cards, scoring profiles, and
      template authoring have focused scroll, resize, compact-window, and
      keyboard coverage (#935, #938, #939, #941).
- [x] Workflow loading, route/task/overlay history, and scoring-profile
      creation have focused recovery and state-transition coverage
      (#936, #937, #943).
- [x] Operations Digest inventory, filters, exclusions, source IDs, window
      semantics, run de-duplication, and data quality reconcile in JSON,
      Markdown, scheduled snapshots, and UI tests (#944).
- [x] Chat has visible, Escape, browser Back, persisted-state, compact-window,
      and native menu recovery coverage; the independently downloaded signed
      app passes the same recovery checks (#945).
- [x] Desktop setup is version-neutral and the bridge consumes Electron's
      application version; the published bundle, health endpoint, updater, and
      bridge all report 6.0.1 (#986).

## 6.0.2 Desktop Recovery Hotfix

- [x] Board Chat and Squad Chat default to a bounded right-side Workbench dock
      and can switch between Right and Bottom without remounting the active
      conversation (#1004).
- [x] Chat width and height clamp to the live viewport; scrolling, wheel input,
      Close, Escape, browser Back, Reset Layout, persisted-state recovery, and
      focus restoration have focused coverage (#1004).
- [x] Native About, copied support information, the desktop bridge, and updater
      fallback consume one authoritative version/build/channel/OS/architecture
      record (#1005).
- [x] Ordinary pull-request verification records affected workspaces without
      running tests; manual focused diagnostics and explicit `ci:full`,
      scheduled, or release milestones own the test suites (#1000, #1227).
- [x] Published release notes are sourced from
      `docs/releases/vX.Y.Z.md`, use one full-width Markdown line per paragraph
      or list item, reject blockquotes and overlong prose blocks, and are
      compared with GitHub during post-publication validation. Run
      `pnpm test:release-format`, `pnpm validate:release`, and the
      post-publication `pnpm validate:release -- --github` check.

## Provider Certification

- [x] Buzz Agent v0.4.24 / `buzz-agent 0.1.0` passes the composed
      credential-free compatibility gate at the pinned commit and fixture
      revision.
- [x] Grok Build v0.2.111 build `94172f2aa4e5` passes exact-version ACP,
      restrictive-policy, source-limitation, and deterministic fixtures.
- [x] Codex app-server 0.145.0 passes exact generated schemas, disabled remote
      control, lifecycle, approval, event, completion, and deterministic
      fixtures.
- [x] Codex CLI and `@openai/codex-sdk 0.149.0` pass their provider-runtime,
      launch, tool, event, credential, and completion gates.
- [x] Claude Code 2.1.218 passes bare-mode launch, permission, environment,
      stream, lifecycle, MCP, event, completion, and deterministic fixtures.
- [x] GitHub Copilot CLI 1.0.74 passes exact ACP handshake, restrictive launch,
      preview/source-limit, and deterministic fixtures.
- [x] Hermes v2026.7.7.2 and OpenClaw v2026.6.11 retain truthful existing
      support and explicit unsupported controls.
- [x] Settings, API, `vk doctor --json`, dispatch, and telemetry report the same
      Detected, Configured, Certified, Degraded, or Unsupported state.
- [x] Every Certified claim has exact runtime/build and passing deterministic
      evidence. Credential-gated smoke is recorded separately; unavailable
      credentials, quota, subscriptions, binaries, and upstream services are
      reported rather than inferred.

## Security, Migration, And Data Preservation

- [x] Legacy provider profiles normalize only through exact built-in
      type/command identity and never fall through to OpenClaw.
- [x] Claude Code permission bypass is absent and unsafe custom launch controls
      fail closed.
- [x] Approval decisions bind to exact action, attempt, reviewer, expiry, and
      authentication freshness; replay and drift tests pass.
- [x] Credential definitions, leases, run catalogs, the `veritas-run` bridge,
      logs, telemetry, fixtures, and APIs remain value-free outside the
      one-shot downstream call.
- [x] Provider protocol frames, stdout/stderr, events, retries, timeouts, and
      retained payloads are bounded and redacted.
- [x] Required unsupported sandbox, network, tool, MCP, credential, lifecycle,
      and provider controls block before attempt mutation.
- [x] A populated v5.2.5 desktop workspace upgrades through an isolated copy
      with matching representative counts, `PRAGMA quick_check=ok`, preserved
      owner/profile metadata, preserved registry absence, and a working v6
      runtime. A separate exact-format v5.2.5 registry fixture verifies populated
      registry compatibility.
- [x] File-backed migration and restore paths pass their seven-test portability
      fixture.
- [x] Rollback guidance has been tested against the actual schema/profile
      posture and does not promise destructive down migration.
- [x] Secret and tracked-runtime-security scans pass.

## Application And Runtime

- [x] A clean dependency install and build produce new shared, server, web, CLI,
      MCP, and desktop outputs without reused `dist`, staged desktop payloads,
      or prior release artifacts.
- [x] An isolated in-app Browser run verifies first-run, login, provider and Buzz
      Settings, degraded states, themes, command-palette focus, and a clean
      console. Deterministic and E2E suites verify task launch, causal events,
      approvals, cancellation, completion, MCP, worktrees, telemetry, and Buzz
      mapping/replay under the maintainer-approved release-evidence split
      recorded in the evidence packet.
- [x] Dark/light themes, keyboard flow, labels, and focus are inspected in the
      in-app Browser; compact layout and recoverable error states pass the E2E
      matrix under the same evidence split.
- [x] A fresh native macOS build verifies one instance, visible window, bundled
      server/web health, menus, shortcuts, window restoration, update check,
      clean close, reopen, and quit.
- [x] The unsigned DMG/ZIP is inspected and the packaged app launches from the
      packaged artifact with an isolated profile.

## Mantine component-system cleanup gate

- [x] Run `pnpm --filter @veritas-kanban/web build` before the bundle check.
- [x] Run `pnpm qa:mantine`.
- [x] Run `pnpm test:e2e -- e2e/mantine-qa-gate.spec.ts`.
- [x] Retain visual and accessibility evidence for current routes, dark/light
      themes, compact widths, keyboard navigation, focus, labels, and touch
      targets.
- [x] Track planned but unavailable surfaces as temporary holdouts instead of
      claiming coverage.
- [x] No active feature imports legacy primitive compatibility wrappers outside
      documented internals.
- [x] No direct shadcn/Radix dependency or vendor-radix bundle returns.
- [x] Bundle sizes remain within the recorded QA budgets or have an explicit
      release-risk acceptance.

## Historical 6.0.2 Final Release Validation Commands

Run from the clean release-candidate worktree:

```bash
node --version
pnpm --version
git --version
pnpm install --frozen-lockfile
pnpm check:pnpm-settings
pnpm audit --prod --audit-level=high
pnpm lint
pnpm lint:budget
pnpm qa:mantine
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:e2e
pnpm smoke:cli-mcp
pnpm test:buzz:compatibility
pnpm desktop:test
pnpm desktop:build
pnpm desktop:check:electron-artifacts
pnpm desktop:smoke:mac:local
pnpm desktop:package:mac:unsigned
pnpm validate:release -- --version 6.0.2
pnpm validate:release -- --version 6.0.2 --docker-build
```

Provider-specific deterministic suites are part of `pnpm test:unit`; record
their test counts and exact fixture baselines separately. Run credential-gated
provider smoke only when the exact binary, authentication, subscription, and
quota are available.

## Historical 6.0.2 Distribution And Post-Publication

- [x] The ready release PR passes required CI and the milestone-wide workspace
      suite, then merges to main.
- [x] Annotated tag `v6.0.2` peels to the exact release merge commit.
- [x] The GitHub release is published from reviewed
      `docs/releases/v6.0.2.md` without hard-wrapped prose.
- [x] Desktop Release completes with signed/notarized arm64 DMG and ZIP,
      blockmaps, `latest-mac.yml`, and SHA-256 sidecars.
- [x] Independent downloads match GitHub digests, sidecars, updater metadata,
      byte sizes, and SHA-256 values.
- [x] DMG and ZIP app signatures, hardened runtime, Gatekeeper, and notarization
      stapling pass.
- [x] The downloaded signed app launches with an isolated profile, reports
      6.0.2 through bundle, health, updater, native About, copied support
      information, and desktop bridge metadata; verifies Right and Bottom Chat
      recovery at the minimum supported window; executes a bounded task; and
      quits cleanly.
- [x] `pnpm validate:release -- --version 6.0.2 --github --repo BradGroux/veritas-kanban`
      passes.
- [x] The Homebrew cask PR uses the published ZIP checksum, merges, and the
      registered tap passes style, strict online audit, dry-run install, and
      livecheck.
- [x] The evidence packet contains release/workflow/asset/Homebrew links,
      exact hashes, runtime results, limitations, and deferred v6.x issues.
- [x] The release tracker closes only after every distribution surface above is
      independently verified.
