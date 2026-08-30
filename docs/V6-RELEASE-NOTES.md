# Veritas Kanban 6.1.3 Release Notes

Veritas Kanban 6.1.3 adds governed file artifacts, provenance-aware execution, operator Run Access controls, and recurring automation activation. It also closes the August Apple-design audit and hardens concurrent storage and provider teardown paths. This is a backward-compatible patch release for 6.1.2 with additive REST contracts and one SQLite migration.

> Veritas Kanban 6.0.0 remains a quarantined prerelease. Version 6.1.3 is the supported stable v6 release after its annotated tag, signed assets, updater metadata, and Homebrew cask are published and verified.

## Backlog Outcomes And Traceability

| Issue                                                            | Operational outcome                                 | Pull request |
| ---------------------------------------------------------------- | --------------------------------------------------- | ------------ |
| [#1247](https://github.com/BradGroux/veritas-kanban/issues/1247) | Governed file-backed Work Products                  | #1270        |
| [#1248](https://github.com/BradGroux/veritas-kanban/issues/1248) | Effective Run Access summary                        | #1275        |
| [#1249](https://github.com/BradGroux/veritas-kanban/issues/1249) | Deterministic recurring automation drafts           | #1276        |
| [#1250](https://github.com/BradGroux/veritas-kanban/issues/1250) | Passive rich artifact previews                      | #1278        |
| [#1251](https://github.com/BradGroux/veritas-kanban/issues/1251) | Digest-bound run file provenance                    | #1277        |
| [#1252](https://github.com/BradGroux/veritas-kanban/issues/1252) | Governed active Run Access transitions              | #1279        |
| [#1253](https://github.com/BradGroux/veritas-kanban/issues/1253) | Bounded standing-authority automation activation    | #1280        |
| [#1254](https://github.com/BradGroux/veritas-kanban/issues/1254) | Isolated HTML artifact previews                     | #1285        |
| [#1255](https://github.com/BradGroux/veritas-kanban/issues/1255) | Provenance-aware execution approval                 | #1286        |
| [#1256](https://github.com/BradGroux/veritas-kanban/issues/1256) | Accessible authentication validation                | #1271        |
| [#1257](https://github.com/BradGroux/veritas-kanban/issues/1257) | Keyboard and touch visibility for secondary actions | #1272        |
| [#1258](https://github.com/BradGroux/veritas-kanban/issues/1258) | Standard macOS Window and Help menus                | #1273        |
| [#1259](https://github.com/BradGroux/veritas-kanban/issues/1259) | Explicit shared motion and stable status feedback   | #1274        |
| [#1291](https://github.com/BradGroux/veritas-kanban/issues/1291) | Correct packaged diagnostics menu label             | #1292        |

## Governed Artifacts, Provenance, And Execution

Work Products can now retain downloadable file artifacts with exact workspace, product version, task, attempt, request, size, digest, media, state, and storage evidence. File and SQLite backends enforce the same idempotency, quarantine, deletion, and integrity contracts. Passive previews support bounded text, JSON, image, audio, video, PDF, archive, and isolated HTML surfaces without granting execution authority.

Run file provenance projects causal run events into digest-bound file history. Operators and agents can distinguish repository-baseline, agent-created, command-created, tool-created, attachment-derived, connector-derived, downloaded, operator-provided, and unknown bytes without persisting credential values.

Run-owned terminal execution now binds direct executable, script, loader, configuration, archive, and load-path inputs to the exact launch baseline or provenance record. External and unknown bytes require a fresh critical human decision. The server rechecks the task envelope, launch manifest, active phase, file bytes, provenance, and approval evidence immediately before spawn. Unsupported indirect or tool transports fail with typed blockers.

## Run Access And Recurring Automation

Operators now receive one redacted, digest-bound Run Access summary spanning filesystem, command, network, tools, integrations, credentials, budgets, provider support, and historical authority. Active access changes use server-owned targets, exact compare-and-set evidence, critical approval where authority expands, durable reversal, and the same phase contract used by dispatch.

Recurring automation drafts are deterministic and revisioned. Activation previews bind the effective Run Access ceiling, provider and workflow readiness, tools, integrations, targets, expiry, budgets, and blockers. Critical human approval is required before standing authority becomes active, and run claims remain bounded, idempotent, and auditable.

## Accessibility, Desktop, And Motion

Authentication, setup, and recovery errors now expose field relationships and concise announcements without moving focus. Secondary task, review, and archive actions reveal on keyboard focus and remain available on coarse pointers, with target-specific accessible names for icon-only controls.

The macOS shell adds standard Window and Help menus while retaining the existing product commands. Shared primitives and high-frequency board, task, activity, template, and chat surfaces use explicit transition properties and stable running or unread states instead of broad or competing perpetual motion. Reduced-motion behavior remains intentional and immediate.

## Reliability And Security Audit

Admission snapshot appends now complete every byte before synchronization, and admission reads serialize with concurrent writers. ACP teardown contains detached reply-write failures without masking awaited transport errors. Workflow-run reads retry bounded regular-file replacements caused by atomic updates while continuing to reject symbolic links and persistently unstable paths.

Packaged macOS acceptance also found and corrected Electron's mnemonic handling for the diagnostics Help item, so the native menu and accessibility tree expose the intended ampersand.

The release audit found no open Dependabot or secret-scanning alerts. One high-severity CodeQL password-hashing alert was dispositioned as a false positive after source review confirmed the SHA-256 input contains only workspace, task, attempt, event-kind, and event-identity metadata. Default-branch CodeQL remains at zero open alerts.

## Verification

The complete release matrix is recorded in [v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md). Normal changes used focused tests. Full workspace units, critical-path coverage, lint, typecheck, builds, security gates, Playwright, load smoke, Docker contract, and macOS/Linux/Windows unsigned artifacts ran at the integration and release milestones.

## Install Or Upgrade

Install or upgrade with Homebrew:

```bash
brew update
brew upgrade --cask bradgroux/tap/veritas-kanban
```

For a first installation:

```bash
brew install --cask bradgroux/tap/veritas-kanban
```

Manual installation uses the signed and notarized macOS arm64 DMG or ZIP from the [v6.1.3 release](https://github.com/BradGroux/veritas-kanban/releases/tag/v6.1.3). Back up the complete stopped-writer workspace before upgrading and keep the backup until the new runtime is accepted.

## Breaking Changes And Migration Warnings

The public REST API remains `v1`, and the new routes and schemas are additive. SQLite migration 34 creates governed work-product artifact storage and indexes. Upgrading from 6.1.2 does not rewrite existing Work Product rows, but an older binary must not open the migrated workspace.

Rollback is restore-first. Stop every writer, reinstall 6.1.2 only when using an unmigrated workspace, and otherwise restore the complete stopped-writer 6.1.2 backup. Never copy an older database over a running instance.

## Known Limitations

Linux and Windows desktop artifacts remain unsigned verification previews. Signed and notarized macOS arm64 is the supported stable desktop distribution. Credential-gated provider smoke remains supplemental and cannot be inferred from deterministic fixtures. HTML previews remain passive, opaque-origin documents with restrictive content security policy and no bridge or run authority. Unsupported indirect file execution and uncertified tool execution remain blocked.

## Release Artifacts

Exact release merge, annotated tag, GitHub release body, signed artifact names, sizes, checksums, updater metadata, signing, notarization, stapling, Gatekeeper, launch/reopen, and Homebrew evidence are recorded in [v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md).
