# ADR 0002: v5 Remote Server Mode and Network Security Posture

## Status

Accepted for v5.0 remote foundation.

Date: 2026-06-03

Issue: [#344](https://github.com/BradGroux/veritas-kanban/issues/344)

## Decision

Veritas Kanban v5 remote access will use a trusted-host model by default: the
Veritas server serves the web or PWA client, REST API, WebSocket endpoint, auth
cookies, static assets, and health endpoints from one origin. Split-origin
deployments remain possible for development and explicitly configured
integrations, but they are not the supported happy path for remote browser,
desktop remote, or mobile/PWA use.

Remote/server mode must never inherit local-only bypass semantics. Any
deployment that binds outside loopback or is reachable through a tunnel,
reverse proxy, LAN, VPN, or public hostname must run with authentication
enabled, localhost bypass disabled, explicit origin policy, and either HTTPS or
a trusted private network boundary.

## Operating Modes

| Mode                        | Binding and route model                                                                            | Security posture                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local-only development      | `127.0.0.1` or `localhost`; Vite may run on a separate dev origin                                  | Localhost bypass may be enabled only for local development or single-user local use. Development CORS and WebSocket localhost origin allowances do not apply to production.                                  |
| Local desktop               | Electron supervises a loopback Veritas server and loads the renderer from that loopback origin     | Local bootstrap credentials are desktop-owned. The renderer does not gain filesystem, process, Keychain, or shell access.                                                                                    |
| Trusted-host LAN/VPN server | Veritas serves `/`, `/api`, `/ws`, health, and static assets from one host on a trusted LAN or VPN | Auth enabled, bypass disabled, strong admin/session secrets, exact origins if any split-origin client is allowed. HTTPS or VPN/tunnel protection is required for browser/mobile use outside loopback.        |
| Reverse-proxy/self-hosted   | Proxy terminates TLS and forwards all Veritas routes to the app server                             | `TRUST_PROXY` must be a hop count or explicit trusted subnet. Proxy must preserve `Host`, `X-Forwarded-*`, and WebSocket upgrade headers.                                                                    |
| Tunnel remote               | Tunnel URL fronts one Veritas origin for web, API, and WebSocket                                   | Treat as remote mode, not localhost. Require auth, disable bypass, verify WebSocket upgrade, and label the connection as tunneled in desktop/mobile diagnostics.                                             |
| Split-origin integration    | Web client and API/WS are intentionally on different origins                                       | Must configure exact `CORS_ORIGINS`, explicit WebSocket origin handling, token storage rules, and proxy headers. This is an exception for development or controlled integrations, not the default remote UX. |

Unsupported or unsafe modes:

- Public or shared-network access with `VERITAS_AUTH_ENABLED=false`.
- Non-loopback access with `VERITAS_AUTH_LOCALHOST_BYPASS=true`.
- Production wildcard CORS.
- `TRUST_PROXY=true`, because it trusts all proxy headers.
- Public HTTP for browser, desktop remote, or mobile/PWA sessions.
- Long-lived credentials embedded in shareable URLs, QR codes, logs, or deep
  links.

## Network And Auth Defaults

Remote/server mode uses these defaults and warnings:

| Area                  | Required posture                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bind address          | Local mode binds to loopback. Server mode requires an explicit operator action such as `HOST=0.0.0.0`, Docker port publishing, a reverse proxy, or a tunnel.                                             |
| Auth                  | `VERITAS_AUTH_ENABLED=true` for every remote mode. Setup must create a human session or use scoped tokens before privileged actions.                                                                     |
| Localhost bypass      | `VERITAS_AUTH_LOCALHOST_BYPASS=false` for LAN, VPN, reverse-proxy, tunnel, desktop remote, and mobile/PWA access.                                                                                        |
| Admin/session secrets | `VERITAS_ADMIN_KEY` must be strong. `VERITAS_JWT_SECRET` should be stable and managed outside logs so sessions survive restart.                                                                          |
| Cookies               | Browser sessions use the `veritas_session` cookie with `httpOnly`, `SameSite=Strict`, and `secure` in production. Remote browser/mobile access therefore requires HTTPS or an equivalent trusted tunnel. |
| CORS                  | Same-origin requires no CORS exception. Split-origin requires exact `CORS_ORIGINS` values with scheme, host, and port. No trailing slash, no wildcard in production.                                     |
| WebSocket origin      | `/ws` origin validation mirrors CORS. Browser origins must match the allowlist or same-origin deployment. Non-browser clients without `Origin` still require auth.                                       |
| Reverse proxy         | Use `TRUST_PROXY=1`, `TRUST_PROXY=2`, `loopback`, or an explicit trusted subnet. Forward `Upgrade`, `Connection`, `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.                                    |
| Rate limiting         | Remote rate limits use the real client IP after trusted proxy processing. Auth endpoints keep stricter limits.                                                                                           |
| CSP                   | Server-delivered web assets keep CSP enforcement. Desktop remote mode must also keep Electron navigation/new-window guards and a sandboxed renderer.                                                     |

## Trusted-Host Same-Origin Contract

The remote happy path is one origin:

```text
https://kanban.example.com/          web or future PWA app shell
https://kanban.example.com/api       REST API
wss://kanban.example.com/ws          WebSocket updates
https://kanban.example.com/health    liveness alias
https://kanban.example.com/health/ready
https://kanban.example.com/api/health
https://kanban.example.com/api/auth/status
```

The current web client already defaults API calls to `${BASE_URL}/api` and
WebSocket connections to `${BASE_URL}/ws`. Sub-path deployments must build with
`VITE_BASE_PATH` so assets, API calls, WebSocket connections, and any future PWA
manifest or service-worker scope stay under the same prefix.

When PWA install support lands, the manifest and service worker must be served
from the same trusted origin and base path as the app shell. Offline behavior
must not cache privileged API responses, stale auth state, task attachments, or
work products unless the release defines an explicit encrypted cache and
revocation model.

## Split-Origin Fallback Contract

Split-origin deployments are allowed only when the operator can state why the
same-origin model is not possible. They must define:

- Exact `CORS_ORIGINS` for every browser origin.
- Explicit API base URL and WebSocket URL configuration.
- WebSocket upgrade support through any proxy in the path.
- Token handling rules that avoid long-lived bearer tokens in local storage,
  URLs, screenshots, logs, and copied diagnostics.
- Cookie expectations. `SameSite=Strict` cookies are same-site only, so
  cross-site browser sessions may need same-site subdomains, a reverse proxy, or
  a future device-session/pairing flow instead of raw bearer tokens.
- CSP connect-src coverage for the API and WebSocket origin if CSP needs to
  cross origins.

If any of those are missing, the split-origin deployment should be considered
unsupported for remote/browser/mobile use.

## Remote Discovery And Validation

Desktop onboarding, mobile setup, and operator smoke tests should validate a
remote origin without leaking credentials:

1. Normalize and display the origin without query strings or fragments.
2. Fetch `GET /api/health` with a short timeout.
   Expected public payload:
   - `ok: true`
   - `service: "veritas-kanban"`
   - `version`
   - `uptimeMs`
   - `timestamp`
3. Fetch `GET /health/ready`.
   Expected public payload:
   - `status: "ok"` or `"degraded"`
   - `checks.storage`
   - `checks.memory`
   - `checks.disk`
   - `timestamp`
4. Fetch `GET /api/auth/status`.
   Expected public payload:
   - `needsSetup`
   - `authenticated`
   - `sessionExpiry`
   - `authEnabled`
5. Attempt a `/ws` upgrade from the same origin and verify the connection can
   authenticate with the current session or a scoped token.
6. For a logged-in user or supplied scoped token, fetch `GET /api/auth/context`
   and show only non-secret metadata: role, actor type, auth method, workspace,
   token name, and permissions.

Validation must redact `Authorization`, `X-API-Key`, cookies, tokens, query
strings, recovery keys, invite tokens, local file paths, attachment names unless
explicitly selected, and user content by default.

## Threat Model

Remote mode expands the attack surface beyond a single loopback browser. The
design must assume hostile origins, stale credentials, shared networks,
malicious attachments, and compromised clients.

| Surface                            | Primary risks                                                                                          | Required controls                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent execution                    | Remote user or token starts local code, shell, workflow, Git, or OpenClaw actions unexpectedly         | RBAC, workflow readiness gates, policy engine, scoped agent tokens, audit trails, explicit user intent for dangerous actions.                                                |
| Git and worktrees                  | Remote-triggered branch, commit, PR, merge, or cleanup actions alter repositories                      | Permission gates, workspace scoping, confirmation for destructive actions, actor attribution, no broad service tokens.                                                       |
| Workflow triggers                  | Remote clients trigger workflows with stale context, denied tools, unsafe outputs, or missing secrets  | Dry-run linting, policy checks, secret availability checks, output target validation, run provenance.                                                                        |
| WebSockets                         | Cross-site WebSocket hijacking, token leakage, unauthenticated subscriptions, connection fan-out abuse | Origin validation, auth on connect, scoped subscriptions, heartbeat cleanup, rate/connection limits, no secret payloads.                                                     |
| File attachments and work products | Malware, path traversal, oversized uploads, private data exposure                                      | MIME/path validation, storage scoping, size limits, sanitized previews, explicit download/export, redacted diagnostics.                                                      |
| Native desktop remote              | Remote origin tries to gain local desktop bridge capabilities                                          | Remote origins get no local-only bridge powers by default. Electron navigation guards, origin allowlist, sandbox, `contextIsolation`, and server-side auth decide authority. |
| PWA/mobile                         | Stale cached data, lost device, token reuse, shareable URLs                                            | Device sessions/pairing, revocation, safe service-worker scope, no long-lived tokens in URLs, visible remote origin labeling.                                                |
| Reverse proxy                      | Spoofed client IP/proto, broken WebSocket upgrade, downgraded TLS                                      | Explicit `TRUST_PROXY`, TLS redirect/HSTS, forwarded header handling, proxy smoke tests.                                                                                     |
| Logs and diagnostics               | Secrets or user content exposed in support bundles                                                     | Default redaction, opt-in user content, query-string stripping, token-pattern scrubbing.                                                                                     |

## Admin Warnings

Settings, desktop onboarding, logs, and docs should warn when a configuration
suggests accidental exposure:

- `HOST=0.0.0.0` or a non-loopback bind with auth disabled.
- `VERITAS_AUTH_LOCALHOST_BYPASS=true` while reachable from non-loopback
  addresses.
- `CORS_ORIGINS=*` or an origin list that does not include the visible remote
  host.
- `TRUST_PROXY=true`.
- Production HTTP origin for browser/mobile sessions.
- Missing or weak `VERITAS_ADMIN_KEY`.
- Missing stable `VERITAS_JWT_SECRET` in a remote deployment.
- Reverse proxy does not support `/ws` upgrade.
- Sub-path deployment missing `VITE_BASE_PATH`.
- Tunnel provider rewrites paths or strips WebSocket upgrade headers.

Warnings should name the unsafe setting and the safer replacement without
printing secret values.

## Diagnostics And Logging

Remote diagnostics should show:

- Normalized origin label.
- Connection mode: local, LAN/VPN, reverse-proxy, tunnel, split-origin, or
  unknown.
- Health status and readiness checks.
- Auth mode and setup/authenticated state.
- WebSocket upgrade status and latency bucket.
- Proxy trust mode and whether forwarded headers are present.
- CSP report-only/enforced state when known.

Remote diagnostics must not show:

- Raw cookies, `Authorization`, `X-API-Key`, API tokens, JWTs, recovery keys, or
  invite tokens.
- Full URLs with credential-bearing query strings.
- User task content, attachment content, or work-product content unless the user
  explicitly includes it in a support bundle.
- Native filesystem paths from another user's machine unless needed and
  redacted.

## Implementation Notes

This ADR defines the posture for #344. Follow-up issues should implement the
missing enforcement and UX pieces:

- #345 device sessions and secure pairing.
- #346 mobile-responsive remote surfaces.
- #347 PWA install support and remote-safe offline behavior.
- #348 realtime sync hardening for multi-client use.
- #350 security review proof against this ADR.
- #352 remote access and admin guides.

ADR 0001 remains the desktop shell architecture. This ADR is the network and
remote trust contract that desktop, browser, mobile/PWA, CLI, MCP, and
self-hosted deployments must share.
