# Security Audit Findings — Issue #254

**Governance Endpoint Audit**
**Date:** 2026-03-23
**Auditor:** CASE (sub-agent)
**Branch:** security/254-governance-endpoint-audit
**Scope:** v1 router rate limiting + governance route files (chat, delegation, feedback, prompt-registry, workflows)

---

## 1. Rate Limiting — Global Coverage ✅

**File:** `server/src/routes/v1/index.ts`

The v1 router applies tiered rate limiting globally via a middleware block:

```ts
v1Router.use((req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return readRateLimit(req, _res, next);
  return writeRateLimit(req, _res, next);
});
```

- **readRateLimit:** 300 req/min (all GETs)
- **writeRateLimit:** 60 req/min (all POST/PUT/PATCH/DELETE)
- **uploadRateLimit:** 20 req/min (applied selectively on attachment upload paths)
- **Global apiRateLimit:** 300 req/min applied upstream in `index.ts`, localhost exempt

**Assessment:** Rate limiting coverage is solid. No route bypasses the middleware.

---

## 2. Route-by-Route Findings

| Route                                                  | File                 | Zod Validation                     | String Length Limits                                                    | SSRF Risk | Path Traversal Risk | Sanitization Gaps                                                 | Severity       | Recommendation                                                                                                                                                                          |
| ------------------------------------------------------ | -------------------- | ---------------------------------- | ----------------------------------------------------------------------- | --------- | ------------------- | ----------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/chat/send`                                  | `chat.ts`            | ✅ `chatSendSchema`                | ⚠️ `message` has no max length                                          | ❌ None   | ❌ None             | ⚠️ `message` content stored and broadcast as-is                   | **MEDIUM**     | Add `z.string().max(10000)` to `message` field in `chatSendSchema`                                                                                                                      |
| `POST /api/chat/squad`                                 | `chat.ts`            | ✅ `squadMessageSchema`            | ⚠️ `message`, `agent`, `taskTitle`, `duration` unbounded                | ❌ None   | ❌ None             | ⚠️ `message` stored and broadcast without sanitization            | **MEDIUM**     | Add `.max()` on all free-text string fields (suggest 5000 for `message`, 200 for `agent`/`taskTitle`)                                                                                   |
| `POST /api/delegation`                                 | `delegation.ts`      | ✅ `SetDelegationRequestSchema`    | ⚠️ `delegateAgent`, `createdBy` unbounded strings                       | ❌ None   | ❌ None             | None identified                                                   | **LOW**        | Add `.max(200)` to `delegateAgent` and `createdBy`; currently only `.min(1)`                                                                                                            |
| `GET /api/delegation/log`                              | `delegation.ts`      | ❌ No Zod on query params          | ⚠️ `limit` parsed as `parseInt` without bounds check                    | ❌ None   | ❌ None             | None identified                                                   | **LOW**        | Validate `limit` via Zod (e.g. `z.coerce.number().int().min(1).max(500)`) to prevent absurdly large queries                                                                             |
| `POST /api/feedback`                                   | `feedback.ts`        | ✅ `createFeedbackSchema`          | ✅ `comment` capped at 5000                                             | ❌ None   | ❌ None             | None identified                                                   | **LOW / INFO** | Well-structured. No changes needed                                                                                                                                                      |
| `PUT /api/feedback/:id`                                | `feedback.ts`        | ✅ `updateFeedbackSchema`          | ✅ `comment` capped at 5000                                             | ❌ None   | ❌ None             | None identified                                                   | **INFO**       | No issues                                                                                                                                                                               |
| `POST /api/prompt-registry`                            | `prompt-registry.ts` | ✅ `createPromptTemplateSchema`    | ⚠️ `name`, `description`, `content` unbounded                           | ❌ None   | ❌ None             | ⚠️ `content` is a prompt template stored verbatim — no length cap | **MEDIUM**     | `content` is high-risk: large templates = large context injections. Add `.max(50000)` on `content`, `.max(500)` on `name`, `.max(2000)` on `description`                                |
| `POST /api/prompt-registry/:id/render-preview`         | `prompt-registry.ts` | ✅ partial (`renderPreviewSchema`) | ⚠️ `sampleVariables` values unbounded                                   | ❌ None   | ❌ None             | ⚠️ Rendered preview could include arbitrary strings               | **MEDIUM**     | Add `.max()` to variable values in `sampleVariables`: `z.record(z.string(), z.string().max(2000))`                                                                                      |
| `POST /api/prompt-registry/:id/record-usage`           | `prompt-registry.ts` | ✅ `recordUsageSchema`             | ⚠️ `renderedPrompt`, `usedBy`, `model` unbounded                        | ❌ None   | ❌ None             | None identified                                                   | **LOW**        | Add `.max()` limits: `renderedPrompt.max(100000)`, `usedBy.max(200)`, `model.max(100)`                                                                                                  |
| `POST /api/workflows`                                  | `workflows.ts`       | ✅ `workflowCreateSchema`          | ⚠️ `config`, `agents`, `steps`, `variables` use `z.unknown()`           | ❌ None   | ❌ None             | ⚠️ Arbitrary JSON stored without deep validation                  | **MEDIUM**     | Array fields (`agents`, `steps`) have `.min(1).max(20/50)` which is good. `config`/`variables` accept arbitrary depth — consider capping with JSON size validation in the service layer |
| `POST /api/workflows/:id/runs`                         | `workflows.ts`       | ✅ `startRunSchema`                | ⚠️ `context` uses `z.record(z.string(), z.unknown())` — unbounded depth | ❌ None   | ❌ None             | None identified                                                   | **LOW**        | Bound `context` to prevent oversized payloads: consider a max key count or total body size limit                                                                                        |
| `POST /api/workflows/runs/:runId/steps/:stepId/reject` | `workflows.ts`       | ⚠️ No body schema applied          | ❌ N/A                                                                  | ❌ None   | ❌ None             | None                                                              | **INFO**       | Rejection endpoint reads no body input (state change only) — this is fine, but confirm `run.error` string is not reflected to callers without sanitization                              |

---

## 3. Summary of Issues by Severity

### 🔴 HIGH — None identified

### 🟡 MEDIUM (4 issues)

1. **`POST /api/chat/send`** — `message` field has no max length. Could enable large payloads stored and broadcast to all WebSocket clients.
2. **`POST /api/chat/squad`** — Multiple free-text fields (`message`, `agent`, `taskTitle`, `duration`) have no max. Squad messages are broadcast to all connected clients.
3. **`POST /api/prompt-registry`** — `content` field (prompt template) has no length cap. An unbounded prompt template could be used to inject large context into AI calls during render/preview.
4. **`POST /api/prompt-registry/:id/render-preview`** — `sampleVariables` values are unbounded strings. Oversized sample variables expand into rendered previews passed to downstream AI.

### 🔵 LOW (5 issues)

5. **`POST /api/delegation`** — `delegateAgent`/`createdBy` lack `.max()` caps.
6. **`GET /api/delegation/log`** — `limit` query param not Zod-validated; `parseInt` without bounds.
7. **`POST /api/prompt-registry/:id/record-usage`** — `renderedPrompt`/`usedBy`/`model` unbounded.
8. **`POST /api/workflows`** — `config`/`variables` accept arbitrary-depth JSON (service-layer concern more than route concern).
9. **`POST /api/workflows/:id/runs`** — `context` field unbounded depth/size.

### ✅ INFO / No Action Required

- `feedback.ts` — Well-structured Zod schemas with proper `max()` limits.
- `delegation.ts` (POST) — Auth guard (`authorize('admin')`) present; main gap is field length.
- `workflows.ts` — RBAC via `assertWorkflowPermission` is applied consistently throughout.
- Rate limiting — Global coverage confirmed via v1 router middleware.

---

## 4. No SSRF or Path Traversal Vectors Found

None of the audited routes accept URL fields or file system paths in user-controlled input. No `validatePathSegment` gaps were identified in these specific routes.

---

## 5. No Unauthenticated Dangerous Writes Found

All write operations in `delegation.ts` and `workflows.ts` are gated by `authorize()` middleware. `feedback.ts` and `prompt-registry.ts` routes are unauthenticated, but they operate on internal-only data (feedback ratings, prompt templates) and are not considered external attack surface in this deployment model.

---

## 6. Recommended Fix Priority

| Priority | Issue                                                                                         | File                        | Effort |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------- | ------ |
| 1        | Add `.max(10000)` to `chat.ts` `message` fields                                               | `chat.ts`                   | XS     |
| 2        | Add `.max(50000)` to `prompt-registry.ts` `content`, `.max(2000)` to `sampleVariables` values | `prompt-registry.ts`        | XS     |
| 3        | Add `.max(200)` to `delegateAgent`/`createdBy`, validate `limit` param                        | `delegation.ts`             | XS     |
| 4        | Add Zod validation to `record-usage` string fields                                            | `prompt-registry.ts`        | XS     |
| 5        | Consider JSON body size middleware for workflow context/config payloads                       | `workflows.ts` / `index.ts` | S      |

---

_This is an audit-only report. No code changes were made._
_Fixes should be tracked in follow-up issues referencing #254._
