# Security Audit Report — Veritas Kanban

**Date:** 2026-01-28  
**Auditor:** Veritas (AI Security Agent)  
**Scope:** Full stack — server, web client, dependencies, infrastructure  
**Server Version:** Express 4.22.1 on Node.js  
**Environment:** Development (macOS, localhost)

---

## Executive Summary

The veritas-kanban project has a **solid security foundation** with recent improvements including Helmet CSP headers, JWT secret rotation, MIME-type magic-byte validation, DOMPurify XSS sanitization, rate limiting via express-rate-limit, WebSocket origin validation, and Zod input validation. However, several issues remain that range from critical (plaintext credentials in task data) to low-severity improvements.

| Severity | Count |
|----------|-------|
| 🔴 Critical | 1 |
| 🟠 High | 3 |
| 🟡 Medium | 6 |
| 🟢 Low | 5 |
| ✅ Pass | 14 |

---

## 🔴 Critical Issues

### CRIT-1: Plaintext Credentials Stored in Task Data (Accessible via API)

**File:** `tasks/active/task_20260128_Wfm3py-update-bird-credentials.md`  
**API Exposure:** `GET /api/tasks` returns task description containing Bird `auth_token` and `ct0` session cookies in plaintext  

**Evidence:**
```
auth_token
4e2e9ef7ac67a9f2942ab2065219244081e0c2ac

ct0
5d90bb73f3dcfa95aed2924db8f9cfaf86140a114045e0dea8b924035b0594c076b2af6196ccca...
```

**Mitigating factors:**
- Task markdown files are gitignored (`tasks/active/*.md` in `.gitignore`)
- File is NOT in git history (confirmed)
- API requires authentication (or localhost bypass)

**Risk:** Any authenticated client or localhost process can read these credentials via the API. If the server is exposed to a network, any local process can obtain these tokens.

**Fix:**
1. Remove credentials from task description immediately
2. Add server-side content scanning to warn when secrets are detected in task fields
3. Consider encrypted storage for sensitive task data

---

## 🟠 High Issues

### HIGH-1: Localhost Bypass Grants Admin Access Without Credentials

**File:** `server/src/middleware/auth.ts:239-242`  
**Config:** `server/.env` → `VERITAS_AUTH_LOCALHOST_BYPASS=true`  

**Evidence:**
```bash
$ curl -s http://localhost:3001/api/tasks  # No auth header
# Returns full task list with admin privileges
```

When `VERITAS_AUTH_LOCALHOST_BYPASS=true`, any process on localhost (including malicious scripts, browser exploits, or other applications) gets full admin access with no authentication.

**Risk:** Any local process can read, modify, or delete all tasks and configuration without credentials.

**Fix:**
1. Disable localhost bypass by default
2. If enabled, limit to `read-only` role rather than `admin`
3. Add warning banner to startup log when bypass is active
4. Consider requiring explicit opt-in per session

---

### HIGH-2: Recovery Key Comparison Not Timing-Safe

**File:** `server/src/routes/auth.ts:297`

```typescript
// Use timing-safe comparison
const valid = config.recoveryKeyHash === recoveryKeyHash;
```

Despite the comment saying "timing-safe comparison," this uses JavaScript's `===` operator which is **NOT** constant-time. An attacker could use timing side-channels to gradually discover the recovery key hash byte-by-byte.

**Risk:** Theoretical timing attack against recovery key verification, though the high-entropy nature of the key (16 chars from 32-char alphabet = ~80 bits) makes practical exploitation very difficult.

**Fix:**
```typescript
import crypto from 'crypto';
const valid = crypto.timingSafeEqual(
  Buffer.from(config.recoveryKeyHash, 'hex'),
  Buffer.from(recoveryKeyHash, 'hex')
);
```

---

### HIGH-3: Content-Disposition Header Injection in Attachment Downloads

**File:** `server/src/routes/attachments.ts:167`

```typescript
res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
```

The `originalName` (from the original upload) is placed directly into the `Content-Disposition` header without sanitizing quotes, newlines, or non-ASCII characters. An attacker could craft a filename containing `"` or CRLF (`\r\n`) characters to inject additional headers.

**Risk:** HTTP response splitting / header injection if filenames contain `"`, `\r`, or `\n`.

**Fix:**
```typescript
// Use RFC 5987 encoding for non-ASCII filenames
const safeName = attachment.originalName.replace(/["\r\n]/g, '_');
const encodedName = encodeURIComponent(attachment.originalName);
res.setHeader(
  'Content-Disposition',
  `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`
);
```

---

## 🟡 Medium Issues

### MED-1: No Server-Side Input Sanitization for XSS Payloads

**Test:**
```bash
$ curl -s -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-admin-key" \
  -d '{"title":"<script>alert(1)</script>","description":"<img src=x onerror=alert(1)>"}'
```

**Result:** Server stores and returns the XSS payload verbatim:
```json
{"title":"<script>alert(1)</script>","description":"<img src=x onerror=alert(1)>"}
```

**Mitigating factors:**
- The web frontend uses `sanitizeText()` via DOMPurify on all user content output (7 components confirmed)
- React's JSX `{}` interpolation escapes HTML entities by default
- This is defense-in-depth: the frontend handles it, but the server should also sanitize

**Risk:** If any client consumes the API without sanitization (mobile app, CLI tool, third-party integration), stored XSS is possible.

**Fix:** Add server-side HTML entity encoding or stripping on task title, description, and comment fields before storage.

---

### MED-2: CSP Allows `unsafe-inline` and `unsafe-eval` in Development

**File:** `server/src/index.ts:67-68`

```typescript
scriptSrc: ["'self'", ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : [])],
```

**Evidence:**
```
Content-Security-Policy: ...script-src 'self' 'unsafe-inline' 'unsafe-eval';...
```

In development mode, the CSP allows inline scripts and eval(), which significantly weakens XSS protection.

**Mitigating factors:**
- Only in development mode (`NODE_ENV !== 'production'`)
- Production CSP is strict

**Risk:** Development environments are less protected against XSS. If dev env is exposed to a network, XSS attacks are easier.

**Fix:** Use nonces or hashes instead of `unsafe-inline`/`unsafe-eval` for Vite HMR. Or document this as accepted dev-only risk.

---

### MED-3: Auth Diagnostics Endpoint Exposes Configuration Details

**Endpoint:** `GET /api/auth/diagnostics` (unauthenticated)

**Response:**
```json
{"enabled":true,"localhostBypass":true,"configuredKeys":0,"hasAdminKey":true}
```

This reveals:
- Whether auth is enabled
- Whether localhost bypass is active
- Number of configured API keys
- Whether an admin key exists

**Risk:** Information disclosure aids attackers in targeting the authentication system.

**Fix:** Require authentication for the diagnostics endpoint, or remove it in production.

---

### MED-4: CORS Rejection Returns 500 Internal Server Error

**Test:**
```bash
$ curl -sI -H "Origin: http://evil.com" http://localhost:3001/api/tasks
HTTP/1.1 500 Internal Server Error
```

**File:** `server/src/index.ts:131`
```typescript
callback(new Error('Not allowed by CORS'));
```

When a disallowed origin makes a request, the CORS middleware throws an error that bubbles up as a 500 status. This is misleading (it's not a server error) and could leak implementation details.

**Risk:** Information leakage via error responses; incorrect status code for legitimate CORS rejection.

**Fix:**
```typescript
callback(new Error('Not allowed by CORS'), false);
// Or handle via errorHandler to return 403
```

---

### MED-5: API Keys Not Configured in Production `.env`

**File:** `server/.env`

```
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=true
VERITAS_ADMIN_KEY=dev-admin-key
CORS_ORIGINS=http://localhost:3000,...
```

Missing:
- `VERITAS_API_KEYS` — no named API keys configured
- `VERITAS_JWT_SECRET` — JWT secret not set (runtime-generated, ephemeral)

**Risk:**
- No named API keys means all non-localhost access uses only the admin key
- Ephemeral JWT secret means all sessions are invalidated on every server restart

**Fix:**
1. Add `VERITAS_API_KEYS` with proper agent/read-only keys
2. Set `VERITAS_JWT_SECRET` for session persistence across restarts

---

### MED-6: Weak Admin Key in Development

**File:** `server/.env`

```
VERITAS_ADMIN_KEY=dev-admin-key
```

The admin key `dev-admin-key` is trivially guessable and matches the value documented in `.env.example`.

**Mitigating factors:**
- Only used in development
- Localhost bypass means the key is rarely needed locally

**Risk:** If the server is ever exposed to a network, this key is easily guessed.

**Fix:** Generate a cryptographically random key: `openssl rand -base64 32`

---

## 🟢 Low Issues

### LOW-1: Health Endpoint Has No Rate Limiting

**Test:** 150 rapid requests to `/health` — all returned 200, no rate limiting.

**File:** `server/src/index.ts:149` — health endpoint defined before rate limit middleware

**Risk:** Could be used for DoS amplification, though `/health` returns a tiny payload (54 bytes).

**Fix:** Apply a generous rate limit (e.g., 300/min) to `/health`, or accept as low risk.

---

### LOW-2: `pnpm audit` Reports 1 Low-Severity Vulnerability

**Package:** `cli` (<1.0.0) — "Arbitrary File Write in cli"  
**Advisory:** GHSA-6cpc-mj5c-m9rq  
**Severity:** Low  
**Fix:** Upgrade to `cli >= 1.0.0`

This appears across root, server, and web workspaces.

---

### LOW-3: Outdated Dependencies

**Server:**
| Package | Current | Latest | Risk |
|---------|---------|--------|------|
| `express` | 4.22.1 | 5.2.1 | Major version upgrade — breaking changes |
| `zod` | 3.25.76 | 4.3.6 | Major version upgrade |
| `@types/exceljs` | 1.3.2 | Deprecated | Should be removed |

**Web:**
| Package | Current | Latest | Risk |
|---------|---------|--------|------|
| `vite` | 6.4.1 | 7.3.1 | Major version upgrade |
| `tailwindcss` | 3.4.19 | 4.1.18 | Major version upgrade |
| `zod` | 3.25.76 | 4.3.6 | Major version upgrade |
| `@types/dompurify` | 3.2.0 | Deprecated | Should be removed |

**Fix:** Evaluate major upgrades for Express 5 (significant middleware changes), Vite 7, and Tailwind 4. Minor updates can be applied immediately.

---

### LOW-4: JWT Token Lacks Subject Claim

**File:** `server/src/routes/auth.ts:221-226`

```typescript
const token = jwt.sign(
  { type: 'session', iat: Math.floor(Date.now() / 1000) },
  getJwtSecret(),
  { expiresIn: expiryStr }
);
```

The JWT only has `type: 'session'` — no `sub` (subject) claim. All sessions are indistinguishable.

**Risk:** Cannot audit which session performed which action; cannot selectively revoke sessions.

**Fix:** Add a session ID or user identifier: `{ type: 'session', sub: 'admin', jti: nanoid() }`

---

### LOW-5: WebSocket Message Parsing Has No Size Limit

**File:** `server/src/index.ts:308-310`

```typescript
ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
```

No maximum message size configured on the WebSocket server. A malicious client could send extremely large JSON messages to cause memory pressure.

**Risk:** Potential memory exhaustion via oversized WebSocket messages.

**Fix:** Add `maxPayload` option to WebSocketServer: `new WebSocketServer({ maxPayload: 64 * 1024 })` (64KB)

---

## ✅ Passing Checks

### PASS-1: Helmet Security Headers ✅

All critical HTTP security headers are present:

```
Content-Security-Policy: default-src 'self'; script-src 'self' ...
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-Permitted-Cross-Domain-Policies: none
X-XSS-Protection: 0 (correct — CSP supersedes)
```

---

### PASS-2: API Rate Limiting ✅

Express-rate-limit properly configured:
- General API: 100 requests/minute per IP
- Strict endpoints: 10 requests/minute (settings, auth)
- Login: 5 attempts with 30-second lockout
- IETF-standard `RateLimit-*` headers emitted
- Rate limit returns 429 with clear error message

**Test confirmed:** Request #1 returned 429 after hitting the limit from prior testing.

---

### PASS-3: Path Traversal Protection ✅

**Test:**
```bash
$ curl -s "http://localhost:3001/api/tasks/../../../etc/passwd"
# Returns: Cannot GET /etc/passwd
```

Express normalizes the URL before routing. The attachment service adds triple-layer protection:
1. `sanitizeFilename()` — strips path separators and special chars
2. `sanitizeTaskId()` — allows only `[a-zA-Z0-9_-]`
3. `validatePathWithinBase()` — verifies resolved path stays within base directory

---

### PASS-4: .env Files Not in Git ✅

- `server/.env` is NOT tracked in git (confirmed via `git ls-files`)
- `.gitignore` properly excludes `.env`, `.env.local`, `.env.*.local`
- `.env.example` files ARE tracked (correct)
- No .env files found in git history (`git log --all --diff-filter=A`)

---

### PASS-5: JWT Secret Rotation ✅

- `rotateJwtSecret()` generates new secret with configurable grace period (default 7 days)
- Multi-secret verification: tries current secret first, falls back to previous
- Admin endpoints: `POST /api/auth/rotate-secret`, `GET /api/auth/rotation-status`
- Legacy migration supported (single jwtSecret → array)
- 16 unit tests covering rotation logic

---

### PASS-6: WebSocket Origin Validation ✅

- `verifyClient` callback validates Origin header before upgrade
- Non-browser clients (no Origin header) allowed through
- Configured origins checked against `ALLOWED_ORIGINS`
- Dev mode allows localhost origins
- Malicious origins rejected with 403

---

### PASS-7: File Upload MIME Validation ✅

- Magic-byte detection via `file-type` package
- Whitelist of allowed MIME types with per-type size limits
- Dangerous extensions blocked (executables, scripts)
- Extension-MIME mismatch detection
- Office XML (zip-based) format handling
- 28 unit tests for validation logic

---

### PASS-8: Input Validation with Zod ✅

**File:** `server/src/routes/tasks.ts:19-24`

```typescript
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  type: z.string().optional().default('code'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});
```

Validation middleware (`server/src/middleware/validate.ts`) wraps Zod schemas for request validation.

---

### PASS-9: Prototype Pollution Protection ✅

**File:** `server/src/schemas/feature-settings-schema.ts:4-11`

```typescript
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
```

Feature settings schema explicitly checks for and blocks prototype pollution keys.

---

### PASS-10: Frontend XSS Sanitization ✅

**File:** `web/src/lib/sanitize.ts`

DOMPurify-based sanitization applied to all 7 components rendering user content:
- `TaskDetailsTab` — task description
- `TaskCard` — description, tooltip, blocked reason
- `CommentsSection` — comment text
- `ReviewComment` — review content
- `TimeTrackingSection` — entry description
- `AgentPanel` — agent output
- `BlockedReasonSection` — blocked reason text

27 unit tests cover script injection, event handler XSS, javascript: URIs, SVG attacks, data: URIs, iframe/form stripping.

---

### PASS-11: Cookie Security ✅

**File:** `server/src/routes/auth.ts:231-237`

```typescript
res.cookie('veritas_session', token, {
  httpOnly: true,           // Not accessible via JavaScript
  secure: NODE_ENV === 'production',  // HTTPS only in production
  sameSite: 'strict',       // No cross-site requests
  maxAge,
  path: '/',
});
```

All three critical cookie flags are set correctly.

---

### PASS-12: Password Hashing ✅

- bcrypt with 12 salt rounds (strong for password hashing)
- Minimum 8-character password requirement
- Login rate limiting (5 attempts, 30-second lockout)
- Recovery key with SHA-256 hash (high-entropy, not user-chosen)

---

### PASS-13: Error Handler Does Not Leak Stack Traces ✅

**File:** `server/src/middleware/error-handler.ts:36-43`

```typescript
// For known errors: returns error message and code only
// For unhandled errors: logs to console but returns generic "Internal server error"
```

No stack traces, file paths, or internal details are sent to clients.

---

### PASS-14: Request Body Size Limit ✅

**File:** `server/src/index.ts:145`

```typescript
app.use(express.json({ limit: '1mb' }));
```

1MB limit prevents large payload DoS attacks.

---

## Recommendations Summary

### Immediate Action Required
1. **Remove plaintext credentials** from task `task_20260128_Wfm3py` description
2. **Fix timing-safe comparison** for recovery key verification
3. **Sanitize Content-Disposition** header in attachment downloads

### Short-Term (This Sprint)
4. Disable or restrict localhost bypass to read-only
5. Add server-side HTML sanitization for task fields
6. Require auth for `/api/auth/diagnostics` endpoint
7. Set `VERITAS_JWT_SECRET` env var for session persistence
8. Generate a strong admin key (replace `dev-admin-key`)

### Medium-Term
9. Fix CORS rejection to return 403 instead of 500
10. Add WebSocket `maxPayload` limit
11. Add `jti` and `sub` claims to JWT tokens
12. Evaluate Express 5, Vite 7, Tailwind 4 upgrades
13. Fix `pnpm audit` low-severity vulnerability

### Long-Term
14. Add server-side content scanning for secrets in task data
15. Consider encrypted storage for sensitive configuration
16. Implement CSP nonces for development mode
17. Add automated security scanning to CI pipeline

---

*Report generated by Veritas Security Audit — 2026-01-28T22:51:00Z*
