# Veritas Kanban PWA Install

Veritas can be installed from a trusted remote/server host as a browser PWA. Use this only with HTTPS, auth enabled, localhost bypass disabled, and the web app, `/api`, `/ws`, manifest, icons, and service worker served from the same public origin or subpath.

## Install On iPhone Or iPad

1. Open the trusted Veritas URL in Safari.
2. Sign in or pair the device session.
3. Tap Share.
4. Tap Add to Home Screen.
5. Confirm the name and tap Add.

iOS uses Safari's Add to Home Screen flow instead of the browser install prompt. The installed shell keeps the Veritas origin and session behavior from Safari.

## Install On Android Chrome

1. Open the trusted Veritas URL in Chrome.
2. Sign in or pair the device session.
3. Tap the browser install prompt, or open the three-dot menu and tap Install app.
4. Confirm Install.

Chrome shows the install prompt only when the manifest and service worker are reachable from the current origin.

## Offline Behavior

The service worker caches only the static app shell, manifest, icons, and same-origin static assets. It does not cache `/api` responses, WebSocket traffic, task data, work products, tokens, comments, or mutation responses.

When the device is offline or realtime sync is reconnecting:

- Veritas shows an offline or stale-data banner in the mobile shell.
- The board disables mobile status changes while the browser reports offline.
- Writes are not queued for later replay.
- Failed writes must return a server error or auth error before the UI treats them as saved.

## Subpath And Reverse Proxy Requirements

For a subpath deployment such as `https://kanban.example.com/veritas/`, build and serve the web app with `VITE_BASE_PATH=/veritas/`. The manifest uses relative `start_url` and `scope`, and the service worker registers under the same base path.

Reverse proxies should route these paths to the same Veritas host:

- `/`
- `/api`
- `/ws`
- `/manifest.webmanifest`
- `/sw.js`
- `/favicon.svg`
- `/icons/*`
- `/assets/*`

If the app is served under a subpath, apply the same subpath prefix to each route.
