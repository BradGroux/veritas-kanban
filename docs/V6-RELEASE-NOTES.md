# Veritas Kanban 6.1.2 Release Notes

Veritas Kanban 6.1.2 completes the reliability, security, persistence, provider-runtime, CI, container, and supportability audit tracked by [#1174](https://github.com/BradGroux/veritas-kanban/issues/1174). It is a backward-compatible patch release for 6.1.1.

> Veritas Kanban 6.0.0 remains a quarantined prerelease. Version 6.1.2 becomes the supported stable v6 release only after the annotated tag, signed assets, updater metadata, and Homebrew cask are published and verified.

## Audit Outcomes And Traceability

| Issue | Operational outcome | Pull requests |
| --- | --- | --- |
| [#1162](https://github.com/BradGroux/veritas-kanban/issues/1162) | Canonical runtime data paths, legacy discovery, and migration compatibility | #1184 |
| [#1163](https://github.com/BradGroux/veritas-kanban/issues/1163) | Service persistence restored behind explicit file and SQLite repositories | #1190-#1220 |
| [#1164](https://github.com/BradGroux/veritas-kanban/issues/1164) | Provider launch, runtime, event, completion, mutation, and adapter contracts decomposed | #1223-#1230 |
| [#1165](https://github.com/BradGroux/veritas-kanban/issues/1165) | Credential-aware JSON, blob, stream, and download API helpers | #1218 |
| [#1166](https://github.com/BradGroux/veritas-kanban/issues/1166) | Measured non-root production Docker runtime and size contract | #1222 |
| [#1167](https://github.com/BradGroux/veritas-kanban/issues/1167) | Immutable external GitHub Actions | #1179 |
| [#1168](https://github.com/BradGroux/veritas-kanban/issues/1168) | Continuous CodeQL, dependency, and secret scanning | #1180 |
| [#1169](https://github.com/BradGroux/veritas-kanban/issues/1169) | Risk-weighted critical-path coverage baselines and ratchets | #1183 |
| [#1170](https://github.com/BradGroux/veritas-kanban/issues/1170) | Four unused direct dependencies removed | #1217 |
| [#1171](https://github.com/BradGroux/veritas-kanban/issues/1171) | Native-loader-compatible Vite and Vitest configuration | #1178 |
| [#1172](https://github.com/BradGroux/veritas-kanban/issues/1172) | Deterministic, milestone-scoped workspace and browser gates | #1175, #1177, #1181, #1228 |
| [#1173](https://github.com/BradGroux/veritas-kanban/issues/1173) | Server lint-warning budget reduced from 600 to 458 | #1221 |
| [#1231](https://github.com/BradGroux/veritas-kanban/issues/1231) | Initial CodeQL baseline triaged, remediated, and dispositioned | #1232-#1235 |

## Persistence And Runtime Paths

`DATA_DIR` and `VERITAS_DATA_DIR` now resolve through one canonical path contract. Live services, health, backup, integrity, migrations, and the production container use the same root. Legacy locations remain discoverable and migrate through explicit compatibility paths rather than creating split authoritative state.

Service-layer filesystem access has been moved into deep repository modules across activity, progress, status history, scheduled deliverables, workflows, broadcasts, conflicts, delegation, ceremony, error analyses, permissions, lifecycle configuration, scheduler, reflection, chat, tasks, telemetry, and managed content. File and SQLite backends preserve their containment, locking, atomic-write, and parity contracts.

## Provider Runtime And Frontend API

Provider work now flows through cohesive launch-compiler, runtime-resolution, event-interpreter, completion, attempt-lifecycle, and adapter-registry boundaries. Explicitly executable providers retain their supported behavior. Provider-less, unknown, or profile/adapter-mismatched records still fail before attempt creation and never route through an implicit OpenClaw fallback.

Frontend JSON, blob, stream, log, and download operations now share credential-aware API boundaries. Cross-origin `VITE_API_URL` cookie authentication, configured base paths, and server error envelopes remain consistent across supported workflows.

## Verification, Security, Dependencies, And Container

Ordinary pull requests now run source-policy, lint, typecheck, build, dependency-audit, secret-scanning, and CodeQL checks without repeatedly executing workspace tests, coverage, E2E, desktop packaging, load, or Docker contracts. Those expensive gates run at explicit `ci:full`, scheduled, manual, integration, security, and release milestones.

The complete final release matrix is recorded in [v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md). Historical test counts are not reused as 6.1.2 evidence.

The production Docker closure excludes unrelated workspace dependencies, runs as a non-root user, and has architecture-specific size ceilings. The implementation baseline measured 195,910,880 bytes on arm64 against a 200,000,000-byte ceiling and 571,590,173 bytes on amd64 against a 600,000,000-byte ceiling; the release candidate is remeasured before publication.

Four verified unused direct dependencies were removed. The server lint-warning budget dropped from 600 to 458 without weakening rules or adding broad suppressions. A coordinated private remediation is integrated through #1236; technical details stay in the advisory workflow pending supported artifacts and explicit disclosure approval. Final milestone validation also corrected recovery-key alphabet generation, WebSocket upgrade header forwarding, same-task lifecycle ordering, and sanitized URI prefix handling through #1239, #1241, and #1243.

The initial 195-alert CodeQL baseline was reviewed alert by alert: 67 findings were fixed and 128 non-exploitable alerts received evidence-backed dispositions. Validated request, logging, persisted-key, file-handling, and sandbox-read findings were fixed in #1232-#1235. Alerts that were limited to test fixtures or were already contained by explicit authentication, path, descriptor, ownership, or atomic-write controls received documented dispositions rather than speculative code churn. The post-merge default-branch analysis reports zero open alerts.

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

Manual installation uses the signed and notarized macOS arm64 DMG or ZIP from the [v6.1.2 release](https://github.com/BradGroux/veritas-kanban/releases/tag/v6.1.2) after publication. Back up the complete stopped-writer workspace before upgrading and keep the backup until the new runtime is accepted.

## Breaking Changes And Migration Warnings

There is no public REST API version change, configuration breaking change, or new SQLite schema migration in 6.1.2. Migrations remain at 30 through 33. Runtime-path normalization can move legacy files into the configured canonical data directory; verify the selected data root, health, integrity, and backup evidence before resuming writers or automation.

Rollback is restore-first. Stop every writer. Reinstall 6.1.1 only when the current data contracts remain compatible; otherwise restore the complete pre-upgrade stopped-writer workspace. Never copy an older database over a live instance.

## Known Limitations

Buzz Agent sessions remain in-memory and do not support session load/resume. Buzz files, reactions, forums, direct messages, and destructive edit/delete projection are not bridged. GitHub Copilot CLI ACP remains public preview. Grok Build's stable artifact still self-reports alpha and cannot be fully traced to the current public source tree. Claude Code's complete CLI implementation is not public, so certification remains bound to exact release behavior and checked-in fixtures.

Deterministic compatibility does not prove provider authentication, subscription availability, quota, or live inference. Linux and Windows desktop artifacts remain unsigned previews; signed and notarized macOS arm64 is the supported stable desktop distribution.

## Release Artifacts

The supported stable desktop release publishes signed and notarized `Veritas-Kanban-6.1.2-mac-arm64.dmg` and `Veritas-Kanban-6.1.2-mac-arm64.zip`, blockmaps, SHA-256 sidecars, and `latest-mac.yml` updater metadata from the annotated `v6.1.2` tag. Exact sizes, hashes, signing, notarization, stapling, Gatekeeper, launch, updater, workflow, release, and Homebrew evidence are recorded after publication in [v6 Release Candidate Evidence Packet](V6-RC-EVIDENCE-PACKET.md).

## Documentation And Evidence

- [Agent provider setup and operations](AGENT-PROVIDERS.md)
- [Harness compatibility matrix](HARNESS-COMPATIBILITY.md)
- [v6 runtime architecture](architecture/V6-AGENT-RUNTIME-CONTROL-PLANE.md)
- [v6 compatibility and release policy](V6-COMPATIBILITY-AND-RELEASE-POLICY.md)
- [v6 upgrade and administration guide](V6-UPGRADE-INSTALL-ADMIN-GUIDE.md)
- [v6 release candidate evidence](V6-RC-EVIDENCE-PACKET.md)
- [Changelog](../CHANGELOG.md)
