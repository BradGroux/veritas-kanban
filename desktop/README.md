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
ports, writes logs under `.veritas-desktop-dev/<profile>/logs`, and uses SQLite
data under `.veritas-desktop-dev/<profile>/data`.

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
- The preload bridge exposes only typed desktop operations:
  `getAppInfo`, `getConnectionStatus`, `restartLocalServer`, `openExternal`,
  and `onServerStatus`.
- Local development mode disables app auth only for the supervised loopback
  runtime. The packaged app path keeps auth enabled and is expected to move to
  keychain-backed bootstrap credentials in the dedicated keychain issue.

## Production Scaffold

`pnpm desktop:build` compiles the Electron main, preload, and fallback renderer.
Packaging, signing, notarization, updater metadata, and bundled server/web asset
layout are handled by later v5 desktop issues. Packaged mode expects a built
server entry at `server/dist/index.js` unless `VERITAS_DESKTOP_SERVER_ENTRY` is
provided.
