# v5 Upgrade, Install, Remote, And Admin Guide

This guide is the release-facing entry point for v5 operators. It links the
existing detailed docs and keeps the happy path separate from optional
automation layers.

For current release-safe dummy screenshots and GIFs of the v5 desktop shell,
resizable Workbench, agent provider settings, task work view, Maintenance
Center, and mobile/PWA shell, see
[v5 Visual Tour](V5-VISUAL-TOUR.md). Release evidence, when needed for a future
candidate, belongs in the reusable
[v5 Release Candidate Evidence Packet](V5-RC-EVIDENCE-PACKET.md).

## Choose The Right Path

| Path                    | Use when                                                                       | Start here                                               | Do not configure on day one                                                |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Local board from source | You want a personal board and dev server.                                      | `docs/SETUP-PATHS.md` and `docs/GETTING-STARTED.md`.     | OpenClaw, MCP writes, Squad Chat webhooks, workflow gates, notifications.  |
| Mac desktop local       | You want the packaged desktop app and bundled local server.                    | This guide plus `docs/DESKTOP-RELEASE.md`.               | Remote exposure, tunnels, multi-user invitations, external webhooks.       |
| Web/source to Mac app   | You already have a file-backed source checkout and want the Mac app to own it. | `docs/WEB-TO-MAC-DESKTOP-MIGRATION.md`.                  | Running the old repo server and desktop app as competing sources of truth. |
| v4 to v5 upgrade        | You have file-backed v4 data and need SQLite.                                  | Migration steps below plus `docs/MIGRATION-RECOVERY.md`. | Deleting old files before the SQLite migration is accepted.                |
| Remote/server           | You want trusted LAN, VPN, reverse proxy, or tunnel access.                    | `docs/guides/SELF_HOST.md` and ADR 0002.                 | Public exposure without auth, HTTPS, backup, and WebSocket validation.     |
| Mobile/PWA              | You want phone/tablet access to a trusted host.                                | `docs/guides/PWA_INSTALL.md`.                            | Native offline execution or queued writes.                                 |
| Multi-user admin        | You manage workspaces, roles, invites, devices, and tokens.                    | `docs/IDENTITY-RBAC.md` and the admin section below.     | Sharing owner/admin tokens with agents.                                    |

## Fresh Mac Desktop Install

1. Install the signed/notarized desktop app with Homebrew:

   ```bash
   brew tap BradGroux/tap
   brew install --cask veritas-kanban
   ```

   Manual install is also supported from the
   [current stable GitHub release](https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.5)
   by downloading `Veritas-Kanban-5.2.5-mac-arm64.zip`, unzipping it, and
   moving `Veritas Kanban.app` into `/Applications`.

   The signed release workflow, checksums, notarization checks, and Homebrew
   publication are recorded in
   [the evidence packet](V5-RC-EVIDENCE-PACKET.md).

2. Launch normally. A stable release should not show a Gatekeeper warning.
3. Pick the first-run path:
   - Use Existing Data when the detected desktop SQLite database already
     contains the expected board. Confirm the displayed counts before securing
     it. Do not rerun migration or restore a backup over it.
   - Board Only for a new, empty local board with no agents.
   - Agent Ready for local agent tooling.
   - Remote Server to pair with a trusted host.
   - Restore Backup is recovery preflight only in v5.2.5. The onboarding card
     does not perform an import. For a governed SQLite export bundle, follow the
     exact target, bundle directory, and destructive replacement steps in
     `docs/WEB-TO-MAC-DESKTOP-MIGRATION.md`.
4. Create the admin password and save the recovery key.
5. Open Settings -> Maintenance and verify health checks, storage, logs, backup,
   and debug-bundle previews.

Desktop data lives under:

```text
~/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/
```

Keep the workspace `data/` directory on the normal local Application Support
filesystem. Do not relocate or symlink the authoritative SQLite database into a
NAS, NFS, SMB, FUSE, iCloud, Dropbox, OneDrive, or other synchronized/remote
folder. The desktop supervisor refuses unsafe or unverified storage before the
local server binds. Use Maintenance to create a completed export/backup, then
copy that artifact to remote storage.

Desktop secrets use the native safe-storage/keychain path documented in the
desktop architecture and release docs. Do not copy raw keychain payloads between
machines.

If an existing source checkout or web/dev install already owns
`localhost:3001`, installing the Homebrew cask does not automatically stop that
server or update its automation. Follow
[`WEB-TO-MAC-DESKTOP-MIGRATION.md`](WEB-TO-MAC-DESKTOP-MIGRATION.md). It covers
both an already-populated desktop database and a file-backed
`tasks/`/`.veritas-kanban/` source, including one-writer cutover, backups,
watchdogs, record counts, first-launch selection, rollback, and packaged auth.

## v4 To v5 Upgrade

For a complete operator runbook that upgrades an existing file-backed
web/source install into the packaged Mac app, use
[`WEB-TO-MAC-DESKTOP-MIGRATION.md`](WEB-TO-MAC-DESKTOP-MIGRATION.md). The
summary below is the storage-level migration contract.

1. Determine whether the desktop SQLite database already contains the expected
   records. If it does, preserve a backup and choose **Use Existing Data**. Do
   not rerun migration.
2. For an authoritative file-backed source, stop the desktop app and every
   competing source server, then preserve the current repo data directory.
3. Start a temporary file-storage server on a non-desktop port and run a dry-run
   migration to a fresh staging database:

   ```text
   POST /api/v1/sqlite/migration/dry-run
   ```

4. Review warnings for malformed tasks, duplicate IDs, missing attachments, and
   backup copy issues.
5. Run the migration to that same fresh staging database only after the dry run
   is clean enough to accept:

   ```text
   POST /api/v1/sqlite/migration/run
   ```

6. Stop the temporary server, checkpoint and validate the staging database, then
   install it into the desktop workspace while no process has the target open.
7. Launch v5, choose **Use Existing Data**, and secure the existing database.
8. Preserve the migration journal, backup directory, and reports.
9. Verify board, task detail, search, workflow, chat, settings, work products,
   Maintenance Center, automation auth, and audit history.
10. Accept the migration only after backup/export and restore drills pass.

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

Do not use browser password sessions as the remote access boundary. In v5 GA the
password session cookie is accepted only for local-owner loopback clients.
Remote browsers, mobile/PWA clients, CLI/MCP clients, and multi-user workflows
must use trusted device sessions or scoped API tokens so workspace membership,
role, revocation, and downgraded scopes are revalidated.

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
- redacted SQLite filesystem posture, effective journal mode, decision source,
  and last integrity check
- cleanup previews
- skill security scans

For backup/import API details, see the SQLite portability and Maintenance
Center sections in `docs/API-REFERENCE.md`. Diagnostics omit the raw database
path, mount point, and mount source. Windows accepts only fixed NTFS/ReFS
volumes; remote, RAM-disk, removable, unsupported, and unresolved volumes fail
closed. Other unvalidated platforms refuse local SQLite startup rather than
assuming filesystem safety. macOS remains the GA desktop target for this
release.

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

- Mac is the only desktop GA target. Linux and Windows artifacts are
  preview-only, unsigned, non-GA validation outputs documented in
  [Desktop Release](DESKTOP-RELEASE.md), not supported v5 install targets.
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
