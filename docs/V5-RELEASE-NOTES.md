# Draft v5.0 Release Notes

These notes are the source draft for the v5.0 GitHub release. Replace the
package version and artifact links when the signed stable release is published.

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

1. Install the signed Mac DMG from the stable release.
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

Stable release must include:

- signed/notarized macOS DMG
- signed/notarized macOS ZIP
- blockmap files
- channel update metadata
- source archive
- changelog entry
- links to upgrade, desktop install, remote/mobile, admin, compatibility, and
  GA checklist docs

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
