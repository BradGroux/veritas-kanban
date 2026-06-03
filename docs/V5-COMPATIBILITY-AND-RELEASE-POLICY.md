# v5 Compatibility And Release Policy

This document defines the v5 release compatibility contract across the desktop
app, bundled server, SQLite schema, CLI, MCP, mobile/PWA clients, workflow
engine, WebSocket sync, migration tooling, and updater metadata.

## Compatibility Matrix

| Surface              | Supported v5 combination                                                                                                                        | Version signal                                                                               | Stale or unsupported behavior                                                                                                                    | Release validation                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| macOS desktop app    | Desktop package, bundled server, web build, shared package, CLI, MCP, and updater metadata must ship from the same workspace version.           | `desktop/package.json`, root `package.json`, app bridge `appInfo.version`, updater metadata. | Show desktop update status as failed or unsupported. Do not silently start with a mismatched bundled server.                                     | `pnpm validate:release`, `pnpm desktop:package:mac:unsigned`, `Desktop Artifacts`, and signed `Desktop Release`. |
| Server/API           | Current v5 clients target API `v1`. Server responses include `X-API-Version: v1`.                                                               | `X-API-Version`, `GET /api/health.version`, package version.                                 | Requests with unsupported `X-API-Version` return `400` with requested, supported, and current versions.                                          | `pnpm validate:release`, CI, API smoke checks.                                                                   |
| SQLite schema        | A v5 app may open supported v5 schema versions only. File-backed v4 data upgrades through the migration service.                                | SQLite migrations, migration journal, recovery state.                                        | Older apps must refuse newer SQLite databases and direct the admin to a compatible app or pre-migration backup restore.                          | Dual-storage parity tests, migration fixture tests, `docs/MIGRATION-RECOVERY.md`.                                |
| CLI                  | CLI package version should match the target server version for release support. Minor patch skew may read, but write support is not guaranteed. | `vk --version`, `vk setup`, `/api/health.version`, `X-API-Version`.                          | `vk setup` must show the reachable server version and fail clearly on auth or API incompatibility.                                               | `pnpm validate:release`, CLI build, CLI read/write smoke from setup docs.                                        |
| MCP server/tools     | MCP package version should match the target server version when write tools are enabled.                                                        | MCP server package version, MCP tool list, `/api/health.version`.                            | Read tools may work with compatible API `v1`; write tools must fail closed on auth or unsupported API responses.                                 | `pnpm validate:release`, MCP build, MCP read/write smoke from setup docs.                                        |
| Mobile/PWA           | Browser/PWA clients must be served from the same trusted origin and build version as the target server.                                         | Web asset hash, service worker scope, `/api/health.version`, WebSocket connection state.     | Offline shell may render cached static assets, but API data is not cached and writes are not queued. Stale clients must refresh before writing.  | PWA install docs, mobile smoke tests, service worker static-cache checks.                                        |
| Workflow definitions | Workflow definition versions are durable per workflow. Runs store the workflow version they executed.                                           | `workflow.version`, `workflowRun.workflowVersion`.                                           | Existing runs remain readable. New runs should dry-run before execution and block unsupported skill, client-mode, or output-target combinations. | Workflow authoring dry-run tests, skill audit gates, run-service tests.                                          |
| WebSocket protocol   | v5 clients use same-origin `/ws` with authenticated human, device, service, or agent context.                                                   | Same-origin URL, auth principal, event names, run/task sequence metadata.                    | Unsupported auth or stale permissions close the socket and require reconnect with a valid session/token.                                         | Realtime sync hardening tests and remote smoke checks.                                                           |
| Migration tooling    | v4 file-backed projects migrate through dry-run, backup, journaled run, recovery-state, and restore-backup endpoints.                           | Migration report, migration journal, backup manifest.                                        | Failed migrations keep file storage as the recovery source. Destructive down migrations are not a GA rollback path.                              | Migration recovery drills, backup/restore tests, release checklist.                                              |
| Updater metadata     | Stable, beta, and dev channels publish channel-specific metadata and artifacts.                                                                 | `latest*.yml`, DMG/ZIP/blockmap artifacts, update status bridge.                             | Bad metadata must be removed or superseded. App rollback does not roll back a migrated SQLite schema.                                            | `Desktop Artifacts`, signed `Desktop Release`, manual updater smoke.                                             |

## Version Negotiation Rules

1. API clients may send `X-API-Version: v1`; unsupported values fail before the
   route handler runs.
2. CLI and MCP setup smoke checks must compare their local package version to
   `/api/health.version` and report skew in release verification notes.
3. Desktop local mode uses a bundled server and web build from the same
   workspace version. A packaged app must not mix release artifacts from
   different commits.
4. Remote and mobile clients must validate `/api/health`, `/health/ready`,
   `/api/auth/status`, and `/ws` from the same public origin before the setup
   path is marked healthy.
5. A client that cannot prove compatible auth, API version, and same-origin
   WebSocket behavior may read cached shell UI only. It must not queue writes.

## Release Channels

| Channel  | Purpose                                                     | Opt in/out                                                                              | Promotion gate                                                                                               |
| -------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dev`    | Local packaged testing and controlled development metadata. | `VERITAS_UPDATE_CHANNEL=dev` plus explicit dev updater config.                          | Local smoke only. Never promoted to users.                                                                   |
| `beta`   | Prerelease testers and release candidates.                  | `VERITAS_UPDATE_CHANNEL=beta` or prerelease version metadata.                           | CI, unsigned artifact smoke, migration dry-run, remote/mobile smoke, no open critical/high release blockers. |
| `stable` | Default Mac GA channel.                                     | Default packaged release channel. Users leave prerelease channels by installing stable. | Signed/notarized DMG, updater metadata, migration recovery drill, security/load evidence, docs published.    |

Promotion between channels is blocked by failed CI, failed desktop packaging,
failed migration recovery, failed backup/restore, failed remote/mobile smoke,
security blockers, unsigned artifacts in a stable release, or stale docs links
from the GA checklist.

## Rollback Policy

| Asset                         | Supported rollback                                                                             | Limit                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| App binary                    | Install the previous signed DMG or supersede the bad update metadata with a corrected release. | Only safe when the existing data schema is compatible with the older app.                      |
| Bundled server/web runtime    | Roll back with the app binary because the server and renderer are packaged together.           | Do not mix server/runtime files between releases.                                              |
| Updater metadata              | Remove, replace, or supersede bad GitHub release assets and channel metadata.                  | Existing downloaded updates may still need user cleanup or reinstall guidance.                 |
| SQLite schema after migration | Restore the pre-migration file-backed backup using the recovery drill.                         | GA does not promise indefinite destructive down migrations from future SQLite schema versions. |
| Remote/self-hosted server     | Admin installs the prior release and restores backup if schema is incompatible.                | Auto-updating self-hosted servers is out of v5 GA scope.                                       |

## Unsupported Combination Copy

Use this pattern in UI, CLI, MCP, and support docs:

```text
This Veritas client is not compatible with the connected server or data schema.
Client: <client version>. Server: <server version>. API: <api version>.
Action: update the older side, refresh the PWA tab, or restore the
pre-migration backup with docs/MIGRATION-RECOVERY.md.
```

Do not include tokens, cookies, private keys, local private paths, raw chat
content, or task body text in compatibility errors or debug bundles.

## GA Validation Checklist

Before publishing stable:

1. Run `pnpm validate:release` after `pnpm build`.
2. Run `pnpm validate:release -- --github --repo BradGroux/veritas-kanban`
   after the tag and GitHub release exist.
3. Run `pnpm desktop:package:mac:unsigned` and inspect artifact names and
   update metadata.
4. Run the `Desktop Artifacts` workflow for unsigned PR artifacts.
5. Run the signed `Desktop Release` workflow only with Apple credentials set.
6. Verify `/api/health.version`, `X-API-Version`, `vk --version`, MCP package
   version, desktop app version, and updater metadata all match the release.
7. Verify migration dry-run, migration run, recovery-state, and restore-backup
   against the release fixture.
