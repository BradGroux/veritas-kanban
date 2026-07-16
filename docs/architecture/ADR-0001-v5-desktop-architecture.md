# ADR 0001: v5 Desktop Architecture

## Status

Accepted for v5.0 Mac GA.

Date: 2026-05-31

## Decision

Veritas Kanban v5.0 will ship the desktop app on Electron with electron-vite,
reuse the existing React/Vite renderer, and supervise the existing TypeScript
Veritas server as the local backend. The desktop shell owns native lifecycle,
windows, menus, updater integration, keychain access, notifications, diagnostics,
and local server process supervision. The renderer remains a browser surface
with no direct Node, filesystem, process, or secrets access.

The v5 desktop architecture does not rewrite the backend. The Express,
WebSocket, SQLite, auth, task, workflow, governance, and work-product services
remain the product backend unless a concrete blocker is discovered during
packaging. Desktop work should adapt startup, paths, connection mode, and auth
bootstrap around that backend instead of creating a parallel native backend.

## Context

v5.0 needs a first-run desktop experience that does not require a terminal. The
app must be able to start local-first, connect to a direct remote host, connect
through a tunnel, survive restarts, expose clear diagnostics, and later support
Linux and Windows without letting those targets block Mac GA.

The current production server already serves the built web client, API, and
WebSocket endpoint from one origin. Development uses Vite on a separate port
with proxying to the Express server. The desktop architecture should preserve
that model and make the desktop shell a supervisor and native bridge, not a
second application platform.

## Goals

- Provide a no-terminal happy path for fresh desktop users.
- Reuse the existing React, Vite, Mantine, TypeScript, Express, WebSocket, and
  SQLite implementation.
- Keep API, WebSocket, task, workflow, governance, and work-product authority in
  the server.
- Define explicit native bridge boundaries before implementation.
- Keep renderer security close to a hardened browser: no Node integration, no
  generic filesystem access, no shell execution.
- Support local, direct remote, and tunnel remote connection modes.
- Preserve a realistic future path for Linux and Windows.

## Non-goals

- Rewriting the backend in Rust, Swift, Go, or native desktop code for v5.0.
- Replacing the web renderer with a native UI for v5.0.
- Shipping production-grade Linux or Windows polish before Mac GA.
- Building a full hosted SaaS platform as part of the desktop shell.

## Shell Decision Matrix

| Criteria                    | Electron with electron-vite                                                                                    | Tauri 2                                                                                        | v5.0 decision                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| React/Vite renderer reuse   | Direct fit with current Vite app and test tooling.                                                             | Good fit, but introduces Rust/webview packaging differences.                                   | Electron.                                                            |
| Local server lifecycle      | Main process can supervise the existing Node server with standard process APIs, logs, signals, ports, and IPC. | Possible, but Node sidecar supervision and cross-platform packaging add Rust/plugin ownership. | Electron.                                                            |
| Native bridge               | TypeScript preload and IPC contracts can share repo types and validation.                                      | Strong command model, but bridge lives in Rust and increases ownership surface.                | Electron for v5.0.                                                   |
| Updater and signing         | Mature macOS signing, notarization, DMG, auto-update, and CI examples.                                         | Improving quickly, but updater/signing path has more moving parts for this repo.               | Electron for Mac GA speed.                                           |
| Keychain and secure storage | Mature Node/native modules or Electron safeStorage plus future keytar-style bridge.                            | Good plugin ecosystem, but Rust/native bridge work is required.                                | Electron for v5.0.                                                   |
| App data paths              | app.getPath gives stable OS paths and simple TypeScript path resolver tests.                                   | Strong path APIs, but responsibilities move into Rust commands.                                | Electron.                                                            |
| Linux/Windows portability   | Larger bundles, but predictable Chromium runtime and common packaging workflows.                               | Smaller bundles and native webviews, but OS webview variability must be tested.                | Electron now, revisit after Mac GA if bundle size becomes a blocker. |
| Security hardening          | Requires strict Electron settings, preload allowlist, navigation guards, CSP, and dependency discipline.       | Smaller native surface by default, but sidecar and plugin boundaries still need hardening.     | Accept Electron risk with explicit guardrails.                       |
| Maintenance cost            | One language and one package manager for desktop shell, renderer, and server lifecycle.                        | Adds Rust ownership and Tauri-specific packaging knowledge.                                    | Electron.                                                            |
| Testability                 | Playwright plus Electron smoke tests can cover first launch, server lifecycle, and renderer flows.             | Testable, but native command and webview behavior require separate harnesses.                  | Electron.                                                            |

Tauri 2 remains a valid future investigation for a smaller package after v5.0
if Electron bundle size, memory footprint, or updater constraints become
release blockers. It is not the v5.0 shell choice.

## Runtime Architecture

```
Electron main process
  - app lifecycle, windows, menus, updater, deep links
  - local server supervisor
  - keychain and app data path resolver
  - native notifications
  - diagnostics bundle builder
  - typed IPC bridge host

Preload bridge
  - typed, narrow desktop API
  - request/response validation
  - event subscription validation

Renderer
  - existing React/Vite/Mantine UI
  - fetches API and WebSocket through configured server origin
  - never reads filesystem, process handles, keychain, or raw native logs

Veritas server
  - existing Express API, WebSocket server, SQLite/file storage services
  - auth, RBAC, workflow, governance, work products, audit, diagnostics
```

### Responsibility Boundaries

| Area               | Renderer                                                              | Electron main/native                                                                                | Veritas server                                                             |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| UI and interaction | Owns app UI, routing, forms, board, workflow views, and user actions. | Owns native window chrome, menus, tray or dock integration, deep links, and notifications.          | Provides data and events.                                                  |
| API authority      | Calls API with session or scoped token.                               | Bootstraps local API origin and stores local secrets.                                               | Authorizes every request and owns workspace state.                         |
| WebSocket events   | Subscribes through server origin.                                     | May consume sanitized server events for native notifications.                                       | Owns event filtering, auth, and subscriptions.                             |
| Filesystem         | No direct access. Requests exports/imports through bridge or API.     | Resolves app paths, file pickers, exports, backup destinations, debug bundles.                      | Owns attachment, backup, export, and work-product storage.                 |
| Process control    | No access.                                                            | Starts, health-checks, restarts, and stops the local server.                                        | Handles graceful shutdown and readiness.                                   |
| Secrets            | Never stores or reads raw secrets.                                    | Stores install token, local session bootstrap material, and remote pairing credentials in Keychain. | Stores hashed API tokens, sessions, RBAC, and audit records.               |
| External URLs      | Requests through bridge.                                              | Validates and opens allowed external URLs.                                                          | May include safe links in API payloads.                                    |
| Diagnostics        | Displays status and redacted summaries.                               | Builds local debug bundle and redacts native material.                                              | Provides `/health`, `/api/health`, `/health/ready`, and admin diagnostics. |

## Typed Native Bridge

The preload bridge is an allowlist, not a generic native API. Every method must
have a shared TypeScript type, runtime validation, explicit error shape, and test
coverage.

Allowed bridge calls:

| Call                                 | Purpose                                                                      | Notes                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `desktop.getAppInfo()`               | Return version, build channel, platform, and update channel.                 | No filesystem paths unless redacted.                                                               |
| `desktop.getEnvironment()`           | Return client mode, API origin, feature flags, and desktop capability flags. | Renderer uses this to choose desktop-aware UI states.                                              |
| `desktop.getConnectionStatus()`      | Return local server status, current mode, health state, and last error.      | Does not expose process handles.                                                                   |
| `desktop.restartLocalServer()`       | Restart the supervised local server.                                         | Requires confirmation in UI and rate limiting in main process.                                     |
| `desktop.selectBackupDestination()`  | Let user choose a destination folder for backup/export.                      | Returns a bookmark or opaque destination id, not unrestricted path access.                         |
| `desktop.exportBackup(request)`      | Request server-backed backup export to selected destination.                 | Data still comes from server authority.                                                            |
| `desktop.createDebugBundle(options)` | Build a redacted diagnostics package.                                        | Must redact tokens, cookies, local URLs with secrets, and user content unless explicitly selected. |
| `desktop.openExternal(url)`          | Open safe external URLs.                                                     | Main process validates scheme and host policy.                                                     |
| `desktop.showItemInFolder(ref)`      | Reveal an export/debug bundle.                                               | Uses opaque refs created by previous bridge calls.                                                 |

Allowed bridge events:

| Event                 | Producer                    | Payload constraints                                                                          |
| --------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `server:status`       | Main process supervisor     | `starting`, `ready`, `degraded`, `restarting`, `stopped`, `failed`; include redacted reason. |
| `connection:changed`  | Main process                | Current mode, origin label, auth state, latency bucket.                                      |
| `update:available`    | Updater                     | Version, channel, release notes URL.                                                         |
| `notification:action` | Native notification handler | Opaque action id and server-side target id only.                                             |
| `deep-link`           | Main process                | Parsed route or invite token handoff, never raw secret logging.                              |

Rejected bridge capabilities:

- Generic `readFile`, `writeFile`, `readdir`, `rm`, `spawn`, `exec`, or shell
  methods.
- Direct renderer access to Keychain, environment variables, process ids,
  arbitrary filesystem paths, or server log files.
- Renderer-defined capabilities, permission grants, command registration, or
  workflow provenance.

## Connection And Origin Model

The canonical production deployment model is same-origin web client, API, and
WebSocket:

- Web client at `/`
- API at `/api`
- WebSocket at `/ws`
- Health at `/health` and `/api/health`

This is already the production server shape and should stay the default for
desktop local mode, direct remote mode, tunnel mode, browser, and mobile/PWA.
Cross-origin API access is an exception for development and explicitly
configured integrations, not the happy path.

### Local Desktop Mode

1. Main process resolves the app data directory and starts the bundled Veritas
   server bound to `127.0.0.1`.
2. The server runs with `VERITAS_STORAGE=sqlite`,
   `VERITAS_DATA_DIR=<resolved app data dir>`, and a generated desktop bootstrap
   token stored in Keychain.
3. Main process chooses a preferred port, then falls back to an ephemeral port
   if the preferred port is unavailable.
4. Main process polls `/api/health` for liveness and `/health/ready` for
   readiness.
5. BrowserWindow loads `http://127.0.0.1:<port>/` only after the server is
   healthy enough to serve the app shell.
6. The renderer talks to `/api` and `/ws` on that same loopback origin.

This avoids file-protocol CSP gaps, custom-protocol CORS complexity, and a
separate desktop-only asset server. The native app can still show a branded
loading window while the local server starts.

### Direct Remote Mode

Direct remote mode loads a trusted HTTPS Veritas origin in the desktop window.
The remote host serves the web client, API, and WebSocket from the same origin.
The local server is not started unless the user explicitly switches to local mode
or requests a local diagnostics operation.

Remote authentication uses normal user sessions, pairing, or scoped tokens. It
does not use localhost bypass and does not grant desktop-only capabilities just
because the UI is running in Electron.

### Tunnel Remote Mode

Tunnel mode connects to a trusted tunnel URL that fronts a Veritas host. The
tunnel endpoint must preserve same-origin routing for the web client, `/api`,
and `/ws`. Tunnel providers must support WebSocket upgrade and must not rewrite
paths in a way that changes API or service-worker scope.

The desktop shell treats tunnel URLs as remote origins with stricter display and
diagnostic labeling so users can tell local, direct remote, and tunneled sessions
apart.

### Browser, Mobile/PWA, CLI, MCP, And Workflow Runs

Browser and mobile/PWA clients use the same server-origin model as remote mode.
CLI and MCP clients use scoped API tokens and never gain renderer or native
bridge capabilities. Workflow-originated runs are server-side provenance records
and must not be inferred from client-provided labels.

## CORS, WebSocket, CSP, Reverse Proxy, And Service Worker Rules

- Same-origin is the default. Prefer serving the web client from the same origin
  as `/api` and `/ws`.
- CORS is allowed only for explicit origins in `CORS_ORIGINS`; wildcard origins
  are not acceptable for desktop or remote production mode.
- WebSocket origin validation must mirror CORS policy and support `/ws` upgrade
  through reverse proxies.
- Reverse proxies must forward `Upgrade` and `Connection` for WebSocket, preserve
  `Host`, and set correct `X-Forwarded-*` headers.
- `TRUST_PROXY=1` or a specific hop/subnet is acceptable behind a trusted proxy;
  `TRUST_PROXY=true` remains rejected.
- Subpath deployments must use `VITE_BASE_PATH` and keep web assets, API, and
  WebSocket routing in one coherent prefix plan. If `/ws` cannot live under the
  same prefix, the deployment must document the explicit WebSocket URL and test
  upgrade behavior.
- Service worker scope must match the served web client scope. Do not enable a
  service worker in desktop local mode for v5.0 unless the release also defines
  cache invalidation, offline semantics, and rollback behavior.
- CSP is enforced by the server for same-origin web delivery. Electron must add
  its own navigation guards, deny unexpected new-window navigation, keep
  `contextIsolation: true`, keep `nodeIntegration: false`, and use a sandboxed
  renderer.
- Remote desktop mode must allow only configured Veritas origins. External links
  leave the app through `desktop.openExternal(url)` after validation.

## Local Server Lifecycle

### Startup

1. Resolve app paths.
2. Load desktop config.
3. Create or read a Keychain-backed install identity and local bootstrap token.
4. Select port: preferred configured port, then next available loopback port,
   then ephemeral loopback port.
5. Start the packaged server process with explicit environment:
   - `NODE_ENV=production`
   - `PORT=<selected port>`
   - `HOST=127.0.0.1` or equivalent server bind configuration
   - `VERITAS_STORAGE=sqlite`
   - `VERITAS_DATA_DIR=<app data dir>`
   - auth secrets sourced from Keychain or generated config, not printed
6. Poll `/api/health` until live.
7. Poll `/health/ready` until storage and readiness checks pass.
8. Load the renderer from the selected loopback origin.

### Port Conflicts

The desktop shell must not require users to diagnose port conflicts manually. If
the preferred port is unavailable on either IPv4 or IPv6 loopback, the main
process records the conflict in desktop logs, chooses another loopback port, and
passes the actual origin to the renderer through the bridge. The dual-stack
probe must reject an accepting wildcard listener even when the operating system
would allow a second address-specific bind on the same port. The UI may show the
selected local origin in diagnostics, but the happy path should proceed without
a terminal. In development mode, the web fallback scan excludes the server port
selected earlier in startup so the two managed processes remain distinct.

### Restart

Restart uses exponential backoff and a visible state transition:
`ready -> restarting -> starting -> ready`. Repeated failures stop at `failed`
with a diagnostic action. Renderer requests to restart are rate limited and do
not expose process ids or signal controls.

### Shutdown

On app quit, main process asks the server to shut down cleanly, then sends
`SIGTERM`, waits for a bounded timeout, and finally force-stops the child process
if needed. The server already handles WebSocket closure, telemetry flush, config
service shutdown, storage shutdown, and HTTP server close; desktop supervision
must preserve that path instead of killing the process first.

### Crash And Orphan Handling

Main process records the child process id and startup token in a runtime state
file. On startup, it detects stale runtime state, verifies whether the process is
still a Veritas-owned local server, and avoids attaching to unrelated processes.
If cleanup is required, it should prefer a server health endpoint or graceful
signal before force-stopping anything.

## App Data Directory Layout

The desktop path resolver owns OS-specific locations and exposes only logical
paths to the renderer.

Mac GA logical layout:

```text
Application Support/Veritas Kanban/
  config/
    desktop.json
    connection-profiles.json
  data/
    veritas.db
    veritas.db-wal
    veritas.db-shm
  attachments/
  backups/
  exports/
  work-products/
  debug-bundles/
  logs/
    desktop.log
    server.log
    updater.log
  runtime/
    server-state.json
    port
    lock
  tmp/
```

Secrets do not live in this directory. Keychain stores desktop install identity,
local bootstrap token material, remote refresh tokens if introduced, and update
channel credentials if any are required.

Future platform mapping:

| Platform | Data/config rule                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Use Electron `app.getPath('userData')` for app data and Keychain for secrets.                                                         |
| Linux    | Follow XDG data, config, state, cache, and runtime directories when packaged.                                                         |
| Windows  | Use LocalAppData/RoamingAppData split intentionally; keep database and logs in local app data unless roaming is explicitly supported. |

All desktop code must use the path resolver. Do not hard-code `/Users`, `~/`,
drive letters, path separators, shell commands, or case-sensitive filesystem
assumptions.

## Client Identity, Mode, Capabilities, And Provenance

The server is the canonical source of truth for client identity, client mode,
capabilities, and run provenance.

Desktop main process can provide an install descriptor during auth bootstrap,
but the server decides the effective session, workspace, role, scopes,
capabilities, and safety gates. The renderer cannot self-declare elevated
capabilities.

| Surface                 | Client mode      | Capability source                                                     | Safety gates                                                            |
| ----------------------- | ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Desktop local           | `desktop-local`  | Server session plus desktop install identity stored through Keychain. | Local bootstrap, RBAC, policy engine, explicit native bridge allowlist. |
| Desktop remote          | `desktop-remote` | Remote server session or pairing token.                               | Remote RBAC, origin allowlist, no local-only bypass.                    |
| Browser                 | `browser`        | Server session.                                                       | RBAC, policy engine, browser CSP, no native bridge.                     |
| Mobile/PWA              | `mobile-pwa`     | Server session or device pairing.                                     | RBAC, policy engine, service-worker scope rules.                        |
| CLI                     | `cli`            | Scoped API token.                                                     | Token scopes, route allowlist, audit.                                   |
| MCP                     | `mcp`            | Scoped agent API token.                                               | Agent token scopes, route allowlist, audit, policy engine.              |
| Workflow-originated run | `workflow`       | Server-created workflow run provenance.                               | Workflow policy, task/workspace scope, audit.                           |

Server-side audit, activity, workflow, and work-product records should include
the resolved `clientId`, `clientMode`, `clientSurface`, `capabilities`, and
`runProvenance` when relevant. Client-provided labels are input hints only.

## Durable Work Products, Notifications, Commands, And Diagnostics

Durable work products remain server-owned. The renderer can request, preview,
download, or export them through API and typed bridge operations, but it never
gets direct filesystem access to the work-product store.

Notifications originate from server events or native lifecycle events. Server
events must be filtered and sanitized before main process displays native
notifications. Notification actions return to the server through typed API calls
with normal auth and audit.

The command registry is server-authoritative for workflow and task commands.
Main process may project safe commands into native menus or deep-link handlers,
but command execution still flows through API or typed bridge calls with explicit
capabilities. The renderer cannot register native commands at runtime.

Post-GA desktop agent workbench extensions must follow the
[Post-GA Desktop Agent Workbench Spec](../DESKTOP-AGENT-WORKBENCH.md), including
server-owned run controls, evidence preservation, approval freshness, and
client-mode action classes.

Diagnostics are split:

- Server diagnostics expose health, readiness, storage, WebSocket count, and
  admin-only deep checks.
- Main process diagnostics collect desktop logs, server logs, update logs,
  desktop config metadata, OS/app versions, and redacted connection state.
- Debug bundles must redact secrets, cookies, auth headers, token-like strings,
  absolute paths unless needed, and user content unless the user opts in.

## Security Boundaries

- Renderer runs with `contextIsolation: true`, `sandbox: true`, and
  `nodeIntegration: false`.
- Preload exposes only the typed bridge described in this ADR.
- Main process validates every bridge call and event subscription.
- Local server binds to loopback for local desktop mode.
- Desktop local mode should use a generated keychain-backed session or scoped
  token. It should not rely on broad localhost bypass for GA.
- Remote and tunnel modes disable localhost bypass and use normal auth.
- Secrets are stored in Keychain or server-side hashed stores, never renderer
  local storage.
- Native file operations use user-selected destinations or app-owned paths.
- External URL opening is allowlisted by scheme and guarded by host policy.
- Updates must verify signatures and channel metadata.
- Debug bundles are redacted by default.
- Every privileged desktop action should leave either server audit evidence,
  desktop log evidence, or both.

## No-terminal Happy Path

Fresh local desktop launch:

1. User opens Veritas Kanban.
2. App shows a native loading/setup screen while main process starts the local
   server.
3. App creates app data directories, local SQLite database, and keychain-backed
   bootstrap credentials.
4. App runs any required migrations.
5. App opens the board when `/api/health` and `/health/ready` pass.
6. If startup fails, app shows a plain diagnostic screen with retry, choose data
   directory, restore backup, open logs, and create debug bundle actions.

Fresh remote launch:

1. User opens Veritas Kanban.
2. User chooses direct remote or tunnel remote.
3. App validates the origin, WebSocket upgrade, health endpoint, and auth mode.
4. User signs in or pairs.
5. App stores allowed connection metadata and opens the remote workspace.

Neither path requires `pnpm`, `node`, `curl`, terminal commands, manual port
selection, or editing `.env` files.

## Implementation Milestones

1. Scaffold `desktop` package with Electron, electron-vite, shared lint/build
   integration, and dev mode that can load the existing web app.
2. Add local server supervisor with port allocation, health polling, restart,
   shutdown, log capture, and local data-dir injection.
3. Add typed preload bridge contracts, runtime validation, and bridge unit tests.
4. Add desktop path resolver and Keychain-backed local bootstrap credential
   storage.
5. Add connection mode selector for local, direct remote, and tunnel remote.
6. Add no-terminal first-run flow, startup diagnostics, and user-safe recovery
   actions.
7. Add native menus, deep links, notifications, and command registry projection.
8. Add backup/export/debug bundle bridge operations.
9. Add signing, notarization, DMG packaging, update channel, and release CI.
10. Add Mac GA smoke checklist and document Linux/Windows follow-up constraints.

## Test Strategy

- Unit test the port allocator, path resolver, server supervisor state machine,
  restart backoff, bridge request validation, bridge event validation, and
  redaction helpers.
- Contract test bridge payloads against shared TypeScript types and runtime
  schemas.
- Add server lifecycle tests for health polling, readiness failure, clean
  shutdown, port conflict fallback, and stale runtime state.
- Add Electron smoke tests for first launch, local server ready state, renderer
  API calls, WebSocket connection, restart, quit without orphaning server, and
  debug bundle creation.
- Add remote-mode smoke tests for origin validation, direct remote health,
  tunnel WebSocket upgrade, and auth failure display.
- Add reverse-proxy deployment tests for `/api`, `/ws`, CSP, service-worker
  scope, `VITE_BASE_PATH`, and `TRUST_PROXY`.
- Keep existing web unit tests and build gates running because the renderer is
  the same app.
- Release CI must validate signing, notarization, DMG creation, updater metadata,
  and fresh install launch on macOS.

## Open Questions

- Which updater provider and channel model will be used for v5.0 Mac GA:
  GitHub Releases, a static update feed, or another provider?
- What are the final bundle identifier, app name, signing identity, and
  notarization secret names?
- Should desktop local mode ever enable a service worker, or should desktop stay
  server-rendered/static without offline caching for v5.0?
- Which tunnel provider integrations should be first-class versus documented as
  reverse-proxy compatible?
- What is the final local auth bootstrap flow: generated local user session,
  scoped desktop token, or a pairing-like loopback flow?
- How long should debug bundles, backups, and updater logs be retained by
  default?
- What is the target minimum macOS version for Mac GA, and what Electron version
  range maps cleanly to it?
- Which Linux and Windows packaging formats should be proven immediately after
  Mac GA?
