# v5 Release Notes

These notes describe the Veritas Kanban v5 stable release line.

- Current source version: `v5.2.5`
- Latest published GitHub release:
  [Veritas Kanban v5.2.5](https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.5)
- Supported packaged install:
  `brew tap BradGroux/tap && brew install --cask veritas-kanban`
- Manual macOS install:
  [Veritas-Kanban-5.2.5-mac-arm64.zip](https://github.com/BradGroux/veritas-kanban/releases/download/v5.2.5/Veritas-Kanban-5.2.5-mac-arm64.zip)

## v5.2.5 Patch

The v5.2.5 release makes the signed desktop upgrade path unambiguous
for operators whose data is already in the desktop SQLite workspace. It also
publishes the provider runtime contract and SQLite safety work merged since
v5.2.4.

### Desktop startup and existing data

- Startup, loading, setup, password, recovery, and login surfaces are draggable
  throughout the frameless desktop flow. Buttons, fields, links, and other
  controls remain clickable because interactive regions opt out of window drag.
- First-run setup detects non-seed rows in the active desktop SQLite database,
  recommends **Use Existing Data**, and shows task, Squad Chat, telemetry,
  workflow-definition, and workflow-run counts before the operator continues.
- **Secure Existing Data** creates the local password and recovery key without
  replacing board records or imported owner metadata.
- Interrupted or stale onboarding state returns to the existing-data path when
  the database remains populated.
- Packaged port selection checks IPv4 and IPv6 loopback before attaching to a
  server, reducing the risk of connecting the app to an unrelated local
  process.

### Migration and recovery guidance

- The new
  [Web To Mac Desktop Migration](WEB-TO-MAC-DESKTOP-MIGRATION.md) runbook
  separates four cases: already-populated desktop SQLite, an empty board, a
  governed export-bundle import, and a legacy file-backed source.
- The file-backed path uses a fresh staging database and isolated loopback
  migration server. It stops writers before backups and never writes through a
  second connection to the authoritative desktop database.
- The guide includes generic source/watchdog discovery, record-count checks,
  exact API-token scopes, authenticated helper cutover, destructive replacement
  warnings, rollback, and remediation for duplicate IDs and missing
  attachments.
- The onboarding **Restore Backup** card remains a native picker/preflight in
  v5.2.5; it does not import during onboarding. Governed imports run from
  Settings -> Maintenance or `/api/v1/sqlite/import`.

### Provider runtime contracts and storage safety

- Agent launches now persist versioned task envelopes and completion-result
  contracts with canonical digests, bounded evidence, side-effect policy,
  verification state, and immutable attempt attribution.
- Codex CLI, Codex SDK, Hermes, OpenClaw, and custom providers expose validated,
  versioned runtime manifests. Routing and active controls fail closed when the
  selected runtime cannot satisfy required capabilities.
- Launch, stop, steer, resume, tool, MCP, structured-output, token, and artifact
  controls consume the exact attempt-bound manifest used for execution.
- SQLite startup classifies the authoritative filesystem before opening the
  database, refuses unsafe or unverified storage, and reports redacted posture
  through health and Maintenance.
- Governed offline journal maintenance adds previews, exclusive restart-time
  conversion, backups, stage journals, integrity verification, recovery,
  ownership locks, and expiring/revocable overrides.

### Reliability and security

- Agent start and terminalization ownership is serialized per task and attempt
  so concurrent starts, stops, provider exits, and callbacks cannot duplicate a
  run.
- Verified local-owner password sessions receive only the narrow packaged
  `local-agent:run` capability; production localhost bypass remains disabled.
- Mobile notifications stay above safe-area navigation and cannot intercept
  Task Detail input after close.
- Patched transitive `fast-uri` and `js-yaml` floors clear the production
  high-severity dependency audit.

### Compatibility and upgrade notes

- No SQLite schema or configuration migration is required from v5.2.4.
- If the desktop database already contains the expected records, back it up,
  install v5.2.5, choose **Use Existing Data**, and then **Secure Existing
  Data**. Do not rerun file migration or restore over that database.
- Server, web, CLI, MCP, shared, and desktop package versions move together to
  5.2.5.
- macOS Apple Silicon remains the supported signed desktop target. Linux and
  Windows artifacts remain unsigned previews.

## v5.2.4 Patch

v5.2.4 restores native macOS editing behavior in the signed desktop app and
corrects the password-recovery action layout.

### Native macOS editing

- The desktop menu now includes Electron's standard Edit role, restoring
  Command-V and the normal Cut, Copy, Paste, Select All, Undo, and Redo menu
  actions for text and password fields.
- Packaged-app verification covers native Command-V in the recovery key, new
  password, and password confirmation fields.

### Password recovery layout

- Recovery inputs and actions now share one 384 px column with the primary and
  secondary actions stacked vertically at full width.
- Login and recovery password fields expose the correct autocomplete metadata
  for password-manager integration.
- Regression coverage protects both the native Edit menu and the recovery form
  structure.

### Compatibility and upgrade notes

- No schema or configuration migration is required from v5.2.3.
- Server, web, CLI, MCP, shared, and desktop package versions move together to
  5.2.4.
- macOS Apple Silicon remains the supported signed desktop target. Linux and
  Windows artifacts remain unsigned previews.

## v5.2.3 Patch

v5.2.3 publishes the signed desktop follow-through for the login-layout fix
that landed after v5.2.2, and promotes the runtime security artifact guard into
the standard local and CI gates.

### Desktop login polish

- Login and password-recovery actions now render in an explicit vertical
  Mantine stack instead of collapsing to intrinsic-width inline buttons.
- The primary login action fills the 384 px form column at a 42 px control
  height; the recovery action is centered beneath it with a full-width hit
  target and subordinate visual treatment.
- The packaged Electron layout is covered by a regression test that asserts
  both actions use Mantine's native block behavior.

### Security gate

- The existing runtime security artifact guard is now a stable package command
  enforced by pre-commit and the CI security job.
- Security-response guidance now covers rotation, history remediation, and
  private evidence handling without changing runtime data or credentials.

### Compatibility and upgrade notes

- No schema or configuration migration is required from v5.2.2.
- Server, web, CLI, MCP, shared, and desktop package versions move together to
  5.2.3.
- macOS Apple Silicon remains the supported signed desktop target. Linux and
  Windows artifacts remain unsigned previews.

## v5.2.2 Patch

v5.2.2 is the July 2026 reliability and interface-audit patch. It restores a
launchable macOS build, closes the web and desktop Apple-design audit backlog,
and hardens workflow and storage behavior without changing the supported v5
data model or requiring an operator migration.

### Desktop and release reliability

- Electron runtime APIs remain external in Vite/Rolldown output, preventing the
  Electron npm installer shim from replacing the native main and preload APIs.
- Desktop builds now inspect emitted artifacts and fail before packaging if the
  installer shim or missing Electron runtime bindings reappear.
- The patched native app was exercised through fresh setup, readiness and
  Keychain status, native menus, keyboard onboarding, window chrome, and local
  notification wiring before release.
- Signed/notarized DMG and ZIP assets, update metadata, blockmaps, and SHA-256
  sidecars replace the broken v5.2.1 desktop artifact set.

### Interface, accessibility, and motion

- Keyboard users can move and reorder Kanban cards across populated and empty
  columns with announcements, rollback, and focus restoration.
- Compact Settings, bottom navigation, Board Chat, and Scoring Profiles now use
  deliberate phone layouts with reachable, touch-sized actions at 320-430 px.
- Scoring Profiles preserves selection across create and duplicate flows and
  protects unsaved edits when navigating away.
- Overlays honor reduced-transparency and increased-contrast preferences, and
  stale task-card tooltips are dismissed before Task Detail opens.
- Dashboard charts and sections no longer animate layout properties or rely on
  broad `transition-all` behavior; reduced-motion updates are immediate.

### Workflow and storage correctness

- Human-gate blocks, bounded cross-step reroutes, workflow HTTP errors, shared
  contracts, and canonical `depends_on` enforcement now follow the documented
  workflow state model.
- File-backed mutations have stronger ordering, rollback, recovery, and
  lifecycle cleanup across concurrent operations.
- Activity history gains append-only JSONL durability, deterministic
  same-millisecond ordering, and stable retention trimming.
- Attachment directories are created lazily by the operations that need them,
  removing an asynchronous startup/teardown race.
- Security artifact matching normalizes path case before classification.

### Compatibility and upgrade notes

- No v5 schema migration is required for v5.2.1 installations.
- Server, web, CLI, MCP, shared, and desktop package versions move together to
  5.2.2.
- Linux and Windows desktop outputs remain unsigned preview artifacts; macOS
  Apple Silicon remains the supported signed desktop target.
- Operators using the v5.2.1 macOS app should replace it with v5.2.2 rather
  than relying on the broken v5.2.1 application bundle to self-update.

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

Install the signed/notarized desktop app with Homebrew:

```bash
brew tap BradGroux/tap
brew install --cask veritas-kanban
```

Manual installation is also supported from the stable GitHub release ZIP.

1. Launch Veritas Kanban. Choose **Use Existing Data** when setup reports the
   expected desktop records; choose **Board Only** only for a new empty board.
2. Save the recovery key.
3. Verify Settings -> Maintenance health, storage, backup, and debug-bundle
   previews.

## Upgrade

1. Inspect the desktop SQLite counts and determine whether the expected data is
   already present.
2. If it is present, create a coherent stopped-app backup, upgrade, choose
   **Use Existing Data**, and do not import or rerun migration.
3. If the file-backed source remains authoritative, follow
   [Web To Mac Desktop Migration](WEB-TO-MAC-DESKTOP-MIGRATION.md) to stop
   competing writers, back up, dry-run and migrate into staging, then install
   the validated database.
4. Verify board, task detail, search, workflows, chat, settings, work products,
   Maintenance Center, authenticated automation, and audit history.
5. Run backup/export and restore verification before deleting old artifacts.

## Release Artifacts

The
[v5.2.5 GitHub release](https://github.com/BradGroux/veritas-kanban/releases/tag/v5.2.5)
contains the signed/notarized macOS ZIP and DMG assets, `latest-mac.yml`,
blockmaps, and SHA-256 sidecars. The release-attached `.sha256` files are the
checksum source of truth.

The v5.2.4, v5.2.3, and v5.2.2 desktop assets remain available for provenance
and rollback.

The v5.2.1 desktop assets remain available for provenance, but the application
bundle is not a supported rollback target because its emitted Electron main
process contains the installer shim fixed in v5.2.2.

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
- [Web To Mac Desktop Migration](WEB-TO-MAC-DESKTOP-MIGRATION.md)
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
