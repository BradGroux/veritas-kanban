# v5 Upgrade, Install, Remote, And Admin Guide

This guide is the release-facing entry point for v5 operators. It links the
existing detailed docs and keeps the happy path separate from optional
automation layers.

## Choose The Right Path

| Path                    | Use when                                                    | Start here                                               | Do not configure on day one                                               |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Local board from source | You want a personal board and dev server.                   | `docs/SETUP-PATHS.md` and `docs/GETTING-STARTED.md`.     | OpenClaw, MCP writes, Squad Chat webhooks, workflow gates, notifications. |
| Mac desktop local       | You want the packaged desktop app and bundled local server. | This guide plus `docs/DESKTOP-RELEASE.md`.               | Remote exposure, tunnels, multi-user invitations, external webhooks.      |
| v4 to v5 upgrade        | You have file-backed v4 data and need SQLite.               | Migration steps below plus `docs/MIGRATION-RECOVERY.md`. | Deleting old files before the SQLite migration is accepted.               |
| Remote/server           | You want trusted LAN, VPN, reverse proxy, or tunnel access. | `docs/guides/SELF_HOST.md` and ADR 0002.                 | Public exposure without auth, HTTPS, backup, and WebSocket validation.    |
| Mobile/PWA              | You want phone/tablet access to a trusted host.             | `docs/guides/PWA_INSTALL.md`.                            | Native offline execution or queued writes.                                |
| Multi-user admin        | You manage workspaces, roles, invites, devices, and tokens. | `docs/IDENTITY-RBAC.md` and the admin section below.     | Sharing owner/admin tokens with agents.                                   |

## Fresh Mac Desktop Install

1. Download the signed/notarized DMG from the stable GitHub release.
2. Mount the DMG and drag Veritas Kanban into `/Applications`.
3. Launch normally. A stable release should not show a Gatekeeper warning.
4. Pick the first-run path:
   - Board Only for a local board with no agents.
   - Agent Ready for local agent tooling.
   - Remote Server to pair with a trusted host.
   - Restore to import a backup.
5. Create the admin password and save the recovery key.
6. Open Settings -> Maintenance and verify health checks, storage, logs, backup,
   and debug-bundle previews.

Desktop data lives under:

```text
~/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/
```

Desktop secrets use the native safe-storage/keychain path documented in the
desktop architecture and release docs. Do not copy raw keychain payloads between
machines.

## v4 To v5 Upgrade

1. Stop the app and preserve the current repo or app data directory.
2. Run a dry-run migration:

   ```text
   POST /api/v1/sqlite/migration/dry-run
   ```

3. Review warnings for malformed tasks, duplicate IDs, missing attachments, and
   backup copy issues.
4. Run the migration only after the dry run is clean enough to accept:

   ```text
   POST /api/v1/sqlite/migration/run
   ```

5. Preserve the migration journal, backup directory, and report.
6. Boot v5 with SQLite storage and verify board, task detail, search, workflow,
   chat, settings, work products, Maintenance Center, and audit history.
7. Accept the migration only after backup/export and restore drills pass.

Rollback means restoring the pre-migration file-backed backup. Do not rely on
destructive SQLite down migrations for GA users. Follow
`docs/MIGRATION-RECOVERY.md` if the migration fails or an older app sees a
newer database.

## Remote And Server Mode

Remote access is a trusted-host setup, not localhost mode. The supported happy
path serves the web app, `/api`, `/ws`, manifest, service worker, health routes,
and static assets from one HTTPS origin.

Minimum remote checks:

```bash
curl https://kanban.example.com/api/health
curl https://kanban.example.com/health/ready
curl https://kanban.example.com/api/auth/status
```

Then verify a WebSocket upgrade to `wss://kanban.example.com/ws` from the same
origin. Keep `VERITAS_AUTH_ENABLED=true` and
`VERITAS_AUTH_LOCALHOST_BYPASS=false` for remote/server mode.

Use safe LAN, VPN, Tailscale, or reverse-proxy examples from
`docs/guides/SELF_HOST.md`. Split-origin deployments require exact CORS,
WebSocket, service-worker, cookie, and token handling as described in ADR 0002.

## Mobile And PWA

Use mobile/PWA only from a trusted HTTPS host. Pair or sign in first, then
install from Safari or Chrome using `docs/guides/PWA_INSTALL.md`.

Mobile-safe behavior:

- Read board, notifications, work products, workflow runs, approvals, and
  settings-lite surfaces allowed by role.
- Status changes are disabled while offline.
- API responses and WebSocket data are not cached for offline replay.
- Writes are not queued for later sync.

Desktop-only behavior remains desktop-only: local app data paths, keychain
management, desktop update checks, local backup/import filesystem actions, and
native menu/deep-link commands.

## Multi-User Admin

Use Settings to manage:

- users and memberships
- roles: owner, admin, member, reviewer, read-only, agent
- invitations and revocation
- trusted devices and paired sessions
- scoped API tokens
- workspaces and workspace switching

Rules:

1. Keep at least one owner.
2. Use admin/member/reviewer/read-only for humans.
3. Use agent or service tokens for automation.
4. Rotate and revoke scoped tokens from the UI when a client is lost.
5. Keep owner/admin credentials out of task descriptions, prompts, logs, and
   support bundles.

## Backup, Restore, Diagnostics, And Maintenance

Use Settings -> Maintenance for:

- health checks
- storage summaries
- redacted log tails
- redacted debug bundles
- SQLite export/import reporting
- cleanup previews
- skill security scans

For backup/import API details, see the SQLite portability and Maintenance
Center sections in `docs/API-REFERENCE.md`.

## Assistant-Safe Setup Prompts

Local board:

```text
Set up Veritas Kanban locally using the board-only path first. Verify
localhost:3000 and localhost:3001/api/health. Do not configure OpenClaw, MCP,
Squad Chat webhooks, workflow gates, notifications, or remote access unless I
ask for that layer.
```

Mac desktop:

```text
Install the signed Veritas Kanban Mac app, choose Board Only first-run setup,
save the recovery key, and verify Settings -> Maintenance health. Do not expose
the app to the network or configure integrations yet.
```

Remote/server:

```text
Configure Veritas Kanban as a trusted same-origin HTTPS host. Keep auth enabled,
disable localhost bypass, verify /api/health, /health/ready, /api/auth/status,
and /ws from the public origin, then document the reverse proxy and backup path.
```

MCP/CLI:

```text
Build the CLI or MCP server from this checkout, set VK_API_URL and a scoped
VK_API_KEY, run the documented read/write smoke checks, and do not use owner or
admin credentials for routine agent writes.
```

## Known v5 GA Limits

- Mac is the only desktop GA target. Linux and Windows are post-GA artifact
  targets documented in [Desktop Release](DESKTOP-RELEASE.md).
- Mobile GA is responsive web plus PWA, not native offline apps. Native mobile
  offline architecture is defined in
  [ADR 0003](architecture/ADR-0003-post-ga-native-mobile-offline.md);
  implementation remains post-GA.
- Hosted cloud sync/SaaS is out of v5 GA scope. The optional post-GA hosted
  model is defined in
  [ADR 0004](architecture/ADR-0004-post-ga-cloud-sync-hosted-saas.md); v5 Mac
  GA has no hosted endpoint, hosted account requirement, or automatic cloud
  sync default.
- Deeper desktop agent workbench features are defined in
  [Post-GA Desktop Agent Workbench Spec](DESKTOP-AGENT-WORKBENCH.md);
  implementation remains post-GA.
- App rollback after SQLite migration is limited by schema compatibility. Use
  the pre-migration backup when an older app cannot open a newer schema.
