# Veritas Kanban Desktop

This package is the v5 native desktop scaffold. It uses Electron with
electron-vite, starts the existing Veritas server as the local backend, and
loads the existing web UI.

## Development

```bash
pnpm desktop:dev
pnpm desktop:dev:fresh
```

`desktop:dev` launches a loopback-only local server and a Vite web renderer
without requiring a separate terminal. The desktop runtime chooses available
ports and isolates data by profile and workspace:
`.veritas-desktop-dev/profiles/<profile>/workspaces/<workspace>/`.

`desktop:dev:fresh` uses the `fresh` profile so onboarding and startup behavior
can be tested without reusing the default development home.

## Runtime Boundaries

- Electron main owns window lifecycle, process supervision, app paths, native
  URL opening, status pages, and future native capabilities.
- Closing the last desktop window quits the app and stops supervised local
  processes. Native menu/background behavior belongs in the dedicated menus
  work.
- The renderer uses the existing Veritas web app and has no Node, filesystem,
  process, or secret access.
- The preload bridge exposes only typed desktop operations. The current v5
  contract covers app/setup diagnostics, local server lifecycle, connection
  validation, update status, native command dispatch, upload/import picking,
  diagnostics bundles, notification actions, work product export, external URL
  opening, and desktop event subscriptions.
- Bridge methods, event channels, validation, and redaction live in the shared
  desktop bridge contract module so main and preload cannot drift silently.
- Dangerous bridge methods require typed request objects and contract validators
  before native execution. Unsupported native features return explicit
  placeholder results until their dedicated v5 issues implement the backing
  behavior.
- Fresh packaged installs store desktop data below the OS app data directory
  returned by Electron `app.getPath('userData')`, then under
  `profiles/<profile>/workspaces/<workspace>/`.
- Packaged desktop installs detect a populated desktop SQLite database and offer
  **Use Existing Data** so setup can secure it without replacing board records
  or imported owner metadata. Do not choose recovery import when the expected
  records are already present. Packaged installs do not automatically import an
  external web/source checkout. Use
  [`docs/WEB-TO-MAC-DESKTOP-MIGRATION.md`](../docs/WEB-TO-MAC-DESKTOP-MIGRATION.md)
  for the already-populated case or when moving file-backed `tasks/` and
  `.veritas-kanban/` data from a repo server into the Mac app's SQLite
  workspace.
- Desktop runtime secrets are created through Electron `safeStorage`, which uses
  the OS credential backend on macOS. The encrypted metadata file lives at
  `<appHome>/config/desktop-secrets.json`; plaintext admin/JWT secrets are only
  passed to the supervised local server process environment.
- Legacy desktop data is copied forward into the profile/workspace app home when
  a new isolated app home is first initialized. The legacy source is left in
  place for manual rollback.
- Local development mode disables app auth only for the supervised loopback
  runtime. Packaged mode keeps auth enabled and uses the keychain-backed
  bootstrap secrets for admin and JWT signing. Local automation that talks to
  the packaged app must send `X-API-Key` or `Authorization: Bearer` rather than
  assuming unauthenticated localhost writes.

## Recovery Notes

If Keychain or encrypted desktop secret state breaks, quit the app, move
`desktop-secrets.json` out of the affected workspace `config` directory, and
restart. The app will regenerate the desktop bootstrap secrets for that
profile/workspace. Existing database files, exports, backups, and debug bundles
remain on disk in the workspace app home.

## Native Commands

The desktop shell owns a single command registry for menu items, keyboard
shortcuts, deep links, notification actions, and renderer bridge dispatch. Menu
commands are forwarded to the renderer through typed bridge events when the web
app owns the business logic, and handled in main only for native operations such
as restarting the local server, opening logs, checking update status, showing a
local notification test, copying redacted diagnostics, and quitting.

Supported `veritas://` deep-link resources include task, workflow, run,
invite/pairing, settings, command center, search, and work product destinations.
Notification previews support a private mode that replaces task/run details
with generic copy while preserving the durable target for click-through.

Window size, position, and maximized state are persisted per profile/workspace
in `config/window-state.json`.

## Release Packaging

Unsigned PR artifacts, macOS signed/notarized release artifacts, update
metadata, and platform smoke steps are documented in
[`docs/DESKTOP-RELEASE.md`](../docs/DESKTOP-RELEASE.md). Use the root
`desktop:package:mac:unsigned` script for Mac release validation. The
`desktop:package:linux:unsigned` and `desktop:package:windows:unsigned` scripts
produce preview-only, non-GA artifacts for post-GA readiness checks. Use
`desktop:release:mac` only for v5 GA; use `desktop:release:linux` or
`desktop:release:windows` only after the platform release prerequisites in the
release guide are promoted.

## Production Scaffold

`pnpm desktop:build` compiles the Electron main, preload, and fallback renderer.
The build then verifies that main and preload import Electron from the native
runtime and do not contain Electron's npm installer shim. Run the artifact
check directly with `pnpm desktop:check:electron-artifacts` when inspecting an
existing build. Packaging, signing, notarization, updater metadata, and bundled
server/web asset layout follow the release workflow documented above. Packaged
mode expects a built server entry at `server/dist/index.js` unless
`VERITAS_DESKTOP_SERVER_ENTRY` is provided.
