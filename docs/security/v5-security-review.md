# Veritas Kanban v5.0 Security Review Notes

Review date: 2026-06-03

Scope: #350, covering multi-user auth, remote pairing, WebSocket scoping, desktop bridge/native surfaces, migration/import, attachments, preview processes, diagnostics, and release gates.

## Review Outcome

The review fixed five high or critical implementation issues in the #350 implementation PR. One additional high issue remains a GA blocker and is called out below.

| Finding                                                                                                                                                                                         | Severity | Outcome                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop `will-navigate` trusted renderer checks used a string prefix, so `http://127.0.0.1:3000@attacker.example` could load attacker-controlled content in the Electron window.                | Critical | Fixed. Desktop navigation now compares parsed URL origins and covers the userinfo bypass in `desktop/src/main/__tests__/navigation.test.ts`.                       |
| Desktop `setWindowOpenHandler` and `will-navigate` opened external URLs directly instead of using the typed bridge validator.                                                                   | High     | Fixed. External navigation now reuses `validateOpenExternalRequest`, blocking unsafe protocols and credentialed URLs before calling Electron `shell.openExternal`. |
| WebSocket chat broadcasts were channel-scoped but not chat-session-scoped. A subscribed or legacy authenticated client could receive live chat deltas for other sessions in the same workspace. | High     | Fixed. Chat delivery now requires an explicit matching session subscription, with broadcast regression coverage.                                                   |
| Revoked API tokens and device sessions stopped new authentication but did not close already-open WebSocket connections.                                                                         | High     | Fixed. WebSocket auth now retains token/session identifiers and identity revocation routes close matching live sockets.                                            |
| Preview start/stop routes used read permissions while starting local child processes for repo preview servers.                                                                                  | High     | Fixed. Preview status/output remain readable with `task:read`, but start/stop now require `admin:manage`; preview process output is redacted before retention.     |

## GA Blocker

Browser password sessions still use the compatibility local-owner model. The JWT proves only that a password login happened; it does not carry a persisted user subject, session id, workspace membership, disabled-user state, or membership downgrade check. `authMethod: "session"` maps to the local admin authority.

This blocks multi-user/server-mode GA unless one of these is true before release:

- Browser sessions are migrated to persisted per-user sessions that revalidate active membership and role on every request and WebSocket connect.
- The GA release explicitly limits password-session mode to single-owner local deployments, with remote/multi-user access requiring device sessions or scoped API tokens.

## Accepted Hardening Risks For This Review

These were not treated as #350 blockers after the fixes above, but they should be triaged before #353 final release sign-off:

| Area                                 | Risk                                                                                                                        | Rationale                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API token and pairing lifetimes      | API tokens can be non-expiring and pairing-created device sessions accept future expirations without a server-side maximum. | Admin-created credentials are already revocable and scoped, but GA should set maximum recommended lifetimes for remote deployments.                                                      |
| WebSocket `api_key` query fallback   | Query-string credentials are easier to leak via logs/proxies than cookies or headers.                                       | Kept only for WebSocket clients that cannot set upgrade headers. HTTP does not accept query API keys.                                                                                    |
| Production origins                   | If `CORS_ORIGINS` is unset, defaults still include loopback development origins.                                            | Remote docs require exact trusted origins. GA packaging/deployment checks should warn or fail on ambiguous production origin config.                                                     |
| Desktop command dispatch             | The renderer can invoke the typed `dispatchCommand` enum, including native restart/update/quit/copy-diagnostics commands.   | The critical remote-content path is fixed by origin enforcement. A future hardening pass should split menu-only native commands from renderer commands or add main-issued intent tokens. |
| Desktop connection validation        | The desktop bridge can fetch renderer-supplied `http`/`https` hosts to validate remote config.                              | This is a limited network oracle by design. Keep scheme and credential validation, and consider private-address confirmation before public remote GA.                                    |
| SQLite portability paths             | Admin restore/import APIs accept filesystem paths and can copy/replace targets.                                             | Admin-only, but final GA should add canonical base-directory and symlink policy tests before broad backup/restore support is advertised.                                                 |
| SVG attachments                      | SVG is accepted as an image type while image previews render `image/*` URLs.                                                | Downloads use attachment disposition and MIME validation exists. GA should either isolate/sanitize SVG previews or remove SVG from inline-previewable types.                             |
| Desktop child logs and debug bundles | Desktop process supervisor writes raw child stdout/stderr.                                                                  | Server logs are redacted and diagnostics bundle creation is stubbed/redacted today. Any debug-bundle implementation must redact process logs before export.                              |
| Future filesystem bridge methods     | Current validators require absolute local paths but do not enforce workspace/bookmark boundaries.                           | The exposed file-picker/export handlers are currently stubbed. Implement boundary checks before enabling real filesystem writes.                                                         |
| macOS entitlements                   | Electron entitlements include unsigned executable memory and disabled library validation.                                   | Common Electron tradeoff, but release packaging should trim entitlements if the final build allows it.                                                                                   |

## Controls Verified

- REST v1 route groups use explicit permission guards, with a route-map parity gate in `scripts/check-permission-coverage.mjs`.
- WebSocket connections validate origin, authenticate before accepting events, filter event delivery by workspace and permission, close backpressured clients, and now require matching chat-session subscriptions for chat streams.
- Device pairing uses random codes, server-side hashes, signed payloads, TTL, attempt locking, one-use redemption, revocation, downgraded-scope clamping, and device-session auth for REST/WebSocket.
- Desktop renderer runs with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- Desktop bridge methods are declared in a typed registry. Dangerous methods require validators, event cleanup is covered, and unsupported client modes cannot call desktop-only bridge methods.
- Desktop safeStorage has no plaintext fallback for runtime secrets.
- Attachments sanitize filenames/task ids, validate resolved paths stay under attachment roots, validate MIME type using content where possible, and serve downloads with attachment content disposition.
- Diagnostics/support snapshots and preview output have redaction coverage for tokens, API keys, bearer values, and private local paths.

## Regression Evidence

Focused tests added or exercised by the review:

- `pnpm --filter @veritas-kanban/desktop test -- navigation.test.ts bridge-contracts.test.ts`
- `pnpm --filter @veritas-kanban/server test -- broadcast-service.test.ts v1-permission-guards.test.ts preview-service.test.ts`

Full release gates should still run before merging the #350 PR:

- `node scripts/check-permission-coverage.mjs`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
