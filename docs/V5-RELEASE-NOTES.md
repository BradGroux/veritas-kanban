# v5 Release Notes

These notes describe the Veritas Kanban v5 stable release line.

- Current source version: `v5.2.1`
- Latest published GitHub release:
  [Veritas Kanban v5.2.1](https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.1)
- Supported packaged install:
  `brew tap BradGroux/tap && brew install --cask veritas-kanban`
- Manual macOS install:
  [Veritas-Kanban-5.2.1-mac-arm64.zip](https://github.com/BradGroux/veritas-kanban/releases/download/v5.2.1/Veritas-Kanban-5.2.1-mac-arm64.zip)

## v5.2.1 Patch

v5.2.1 records the completed v5.2 audit follow-up pass, publishes signed
macOS release assets, and updates the supported Homebrew install channel.

- Disabled communication adapters now block inbound human reply ingestion
  before creating Squad Chat messages or thread mappings.
- Delegated workspace intake now leaves a recoverable pending delegation if
  persistence fails mid-handoff, and retries can reconcile the target task by
  delegation ID.
- The static docs homepage no longer carries brittle launch-era star and exact
  test-count claims.
- Queue monitor selection was audited and left unchanged because current sorting
  already puts runnable candidates ahead of blocked work before the cap.
- Release CI was hardened by waiting for workflow-run metadata completion and
  file-backed ChatService directory initialization before temp workspaces are
  removed.

## v5.2.0 Release

v5.2.0 closes the post-v5.1 backlog train and the follow-up audit issues found
after that work landed. It keeps the v5 storage, desktop, security, and
migration posture unchanged from v5.1.0.

- Team roster manifests, capability routing, cross-workspace capability
  discovery, and delegated intake make work handoffs explicit before agents
  accept tasks.
- Queue intake monitoring and the recurring scheduler unify GitHub issue
  watches, agent-run monitors, workflows, digests, and follow-up loops.
- Squad Chat now has durable threads, unread state, mentions, search, and
  bidirectional human reply adapters for chat and notification channels.
- Ceremony enforcement adds design-review and failure-retrospective gates for
  the workflows that should not proceed without recorded review evidence.
- Reflection memory promotion turns agent corrections and lessons into a
  reviewable memory queue instead of losing useful run context in chat history.
- External tracker schema introspection lets configurable work item mappings
  inspect tracker field shape before sync.
- Release audit follow-ups removed the vulnerable frontmatter dependency path,
  upgraded DOMPurify, made CLI/MCP smoke checks skip cleanly without
  `VK_API_KEY`, and kept initial Mantine bundle size under the QA budget.

## v5.1.0 Release

v5.1.0 completes the post-v5.0 agent governance and collaboration release
train while preserving the v5 storage, desktop, security, and migration
posture.

- Docker source builds include the required server, web, shared, CLI, MCP, and
  desktop workspace inputs so self-host validation can build from a clean
  context.
- Sandbox policy presets define reusable filesystem, network, environment, and
  credential boundaries for agent launches, with dry-run validation before run
  start.
- Agent budget enforcement adds auditable token, cost, tool-call, runtime,
  retry, and fan-out guardrails across workspace, agent, workflow, workflow
  agent, and one-off run scopes.
- Agent profile packages can be imported, validated, exported, enabled, edited,
  and used at launch so role/runtime/prompt/tool/sandbox/budget posture can
  travel as YAML or JSON.
- Decision review sessions capture independent participant responses, critique
  rounds, final synthesis packets, work-product attachment, and decision audit
  links.
- Shared live run sessions let workspace members create view, co-drive, or fork
  shares for active task runs. Viewers receive live output and events, editors
  send attributed messages and mobile-safe approvals, and forks create linked
  tasks without changing the parent run.

## v5.0.1 Patch

v5.0.1 is a small MCP/runtime patch release. It keeps the v5 storage,
desktop, security, and migration posture unchanged from v5.0.0.

- MCP write tools now return concise confirmations instead of echoing the full
  task JSON and complete comment history on every mutation.
- Read tools remain the full-detail paths: `get_task`, `list_tasks`, and
  `list_comments`.
- The MCP documentation and response-contract tests cover the concise write
  behavior.
- The Mantine task detail Progress tab test was stabilized under CI load while
  validating the patch.
- The local macOS desktop packaging smoke check now follows the configured app
  bundle name.

## Highlights

- Native macOS desktop app with bundled local server lifecycle, app data paths,
  safe-storage backed secrets, menus, notifications, deep links, setup
  diagnostics, updater status, and signed/notarized release workflow.
- SQLite-backed v5 storage with file-to-database migration, dry-run reports,
  migration journals, backup/export/import, rollback recovery, and dual-storage
  parity coverage.
- Multi-user workspaces with roles, memberships, invitations, scoped API
  tokens, device sessions, actor attribution, optimistic concurrency, and RBAC
  coverage across REST, WebSocket, CLI, MCP, and workflow paths.
- Remote/mobile access for trusted same-origin hosts, secure pairing, hardened
  realtime sync, responsive mobile surfaces, and PWA install support with
  static-shell-only offline behavior.
- Cohesive v5 work surfaces: Work View, action queue, readiness gates, durable
  work products, completion packets, universal search, workflow authoring,
  policy decision traces, maintenance center, product modes, skill capability
  profiles, skill security scanning, and orchestrator/subagent pipelines.
- Refreshed release documentation captures the current desktop shell, resizable
  Workbench bottom panel, Codex-default agent provider settings, task work view,
  Maintenance Center, and mobile/PWA shell using release-safe dummy content.

## Breaking Changes And Migration Warnings

- v5 promotes SQLite as the primary GA storage backend. Run the migration dry
  run and preserve the pre-migration backup before accepting the SQLite
  database.
- Rolling back the app binary after a SQLite migration is only safe when the
  older app supports the current schema. Otherwise restore the pre-migration
  file-backed backup.
- Remote/server mode must not rely on localhost bypass. Enable auth, use HTTPS
  or a trusted VPN/tunnel, and validate `/api`, `/ws`, manifest, service worker,
  and static assets from the same origin.
- PWA/mobile offline support caches only the static shell. It does not cache API
  data, WebSocket events, tokens, task contents, comments, work products, or
  mutation responses.
- Owner/admin credentials are not for routine agents. Use scoped agent or
  service tokens and revoke lost devices or tokens from Settings.

## Fresh Install

1. Install the signed Mac desktop app:

   ```bash
   brew tap BradGroux/tap
   brew install --cask veritas-kanban
   ```

   Manual install is also supported from the stable GitHub release ZIP.

2. Launch Veritas Kanban and choose Board Only unless you already need agent or
   remote setup.
3. Save the recovery key.
4. Verify Settings -> Maintenance health, storage, backup, and debug-bundle
   previews.

## Upgrade

1. Back up the existing v4 file-backed project or desktop data directory.
2. Run migration dry-run.
3. Resolve warnings or record accepted risks.
4. Run migration and preserve the journal/report.
5. Verify board, task detail, search, workflows, chat, settings, work products,
   Maintenance Center, and audit history.
6. Run backup/export and restore verification before deleting old artifacts.

## Release Artifacts

The v5.2.1 stable desktop release publishes signed/notarized macOS ZIP and DMG
assets plus `latest-mac.yml`, blockmaps, and SHA-256 sidecars under the
[v5.2.1 GitHub release](https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.1).
Use the release-attached `.sha256` files as the checksum source of truth.

The v5.2.0 desktop assets remain available under the
[v5.2.0 GitHub release](https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.0).

The v5.0.0 stable desktop release artifacts are retained here as the v5 baseline
used by the updater evidence packet:

| Artifact                                                                                                                                                        | SHA-256                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Veritas-Kanban-5.0.0-mac-arm64.dmg](https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.dmg)                   | `f3d0c3a70b66c27c27db527b2cdeb8ac86f174630c951a429eeb59b4080bf0ae` |
| [Veritas-Kanban-5.0.0-mac-arm64.zip](https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.zip)                   | `bfd1e57fc99b4468f9fd97418c2aa57b51a1e3087966539c60a75c848c595cb1` |
| [Veritas-Kanban-5.0.0-mac-arm64.dmg.blockmap](https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.dmg.blockmap) | `0d10746c0703e1ac1409b9a370ed2bd8195dc25fc8f9e1384f909140f5e00a0e` |
| [Veritas-Kanban-5.0.0-mac-arm64.zip.blockmap](https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.zip.blockmap) | `2eb8b8a93cca84f1579736ce06bf5107edd688c9d941ce83ba3876982ec52d09` |
| [latest-mac.yml](https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/latest-mac.yml)                                                           | `535cd6da5e95dff8dcf869fa2b236a2b1ddcc4dff118f325b41265cb96f14db1` |

Checksum sidecars are published as
[`Veritas-Kanban-5.0.0-mac-arm64.dmg.sha256`](https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.dmg.sha256)
and
[`Veritas-Kanban-5.0.0-mac-arm64.zip.sha256`](https://github.com/BradGroux/veritas-kanban/releases/download/v5.0.0/Veritas-Kanban-5.0.0-mac-arm64.zip.sha256).

The GitHub release also includes the source archive and links to the upgrade,
desktop install, remote/mobile, admin, compatibility, and GA checklist docs.

## Documentation

- [v5 Upgrade, Install, Remote, And Admin Guide](V5-UPGRADE-INSTALL-ADMIN-GUIDE.md)
- [v5 Visual Tour](V5-VISUAL-TOUR.md)
- [v5 Compatibility And Release Policy](V5-COMPATIBILITY-AND-RELEASE-POLICY.md)
- [v5 GA Checklist](V5-GA-CHECKLIST.md)
- [Post-GA Desktop Agent Workbench Spec](DESKTOP-AGENT-WORKBENCH.md)
- [Post-GA Native Mobile Offline ADR](architecture/ADR-0003-post-ga-native-mobile-offline.md)
- [Post-GA Cloud Sync And Hosted SaaS ADR](architecture/ADR-0004-post-ga-cloud-sync-hosted-saas.md)
- [Desktop Release](DESKTOP-RELEASE.md)
- [Migration Recovery](MIGRATION-RECOVERY.md)
- [Self-Hosting Guide](guides/SELF_HOST.md)
- [PWA Install](guides/PWA_INSTALL.md)
- [Identity, Workspace, And RBAC](IDENTITY-RBAC.md)
- [Maintenance Center](MAINTENANCE-CENTER.md)
- [v5 Security Review](security/v5-security-review.md)
- [v5 Performance And Load Test Notes](testing/v5-performance-load.md)

## Post-GA Follow-Up

- Linux and Windows unsigned desktop artifacts remain preview-only, non-GA
  validation outputs documented in [Desktop Release](DESKTOP-RELEASE.md).
- Native mobile apps with offline execution are scoped in
  [ADR 0003](architecture/ADR-0003-post-ga-native-mobile-offline.md).
- Cloud sync and hosted SaaS are scoped as optional post-GA work in
  [ADR 0004](architecture/ADR-0004-post-ga-cloud-sync-hosted-saas.md).
- Deeper desktop agent workbench features are scoped in
  [Post-GA Desktop Agent Workbench Spec](DESKTOP-AGENT-WORKBENCH.md).
