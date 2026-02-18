# n8n Offload Candidates — Veritas Kanban

> **Audit date:** 2026-02-18  
> **n8n instance:** `https://automation.ops.digitalmeld.cloud`  
> **Auditor:** vk-n8n-audit (automated)

## Summary

Veritas Kanban's server has **16 identified workflows** running in-process that could potentially be offloaded to n8n. Of these, **6 are quick wins** (easy feasibility, high priority) that would reduce server complexity and improve observability with minimal effort.

**Key benefits of offloading:**

- Reduces VK server memory/CPU footprint
- Gives workflows visual debugging, retry logic, and monitoring via n8n UI
- Decouples background processing from the main Express process
- Enables non-developer workflow editing

---

## Workflow Inventory

| #   | Workflow                                                      | Source File                         | Current Impl                               | n8n Feasibility | Priority   | Recommended n8n Trigger                 | Quick Win? |
| --- | ------------------------------------------------------------- | ----------------------------------- | ------------------------------------------ | --------------- | ---------- | --------------------------------------- | ---------- |
| 1   | [GitHub Issues Sync (polling)](#1-github-issues-sync)         | `github-sync-service.ts`            | `setInterval` polling (5 min default)      | **Easy**        | **High**   | Schedule (5 min cron)                   | ✅         |
| 2   | [Stale Agent Cleanup](#2-stale-agent-cleanup)                 | `agent-registry-service.ts`         | `setInterval` (configurable)               | **Easy**        | **High**   | Schedule (every 2 min)                  | ✅         |
| 3   | [Telemetry Retention Cleanup](#3-telemetry-retention-cleanup) | `telemetry-service.ts`              | On-init (startup only)                     | **Easy**        | **High**   | Schedule (daily at 3 AM)                | ✅         |
| 4   | [Failure Alert Dispatch](#4-failure-alert-dispatch)           | `failure-alert-service.ts`          | In-process (event-driven)                  | **Easy**        | **High**   | Webhook (from VK telemetry POST)        | ✅         |
| 5   | [Clawdbot Webhook Relay](#5-clawdbot-webhook-relay)           | `clawdbot-webhook-service.ts`       | Fire-and-forget HTTP POST + retry          | **Easy**        | **Medium** | Webhook (from VK task events)           | ✅         |
| 6   | [Squad Webhook Relay](#6-squad-webhook-relay)                 | `squad-webhook-service.ts`          | Fire-and-forget HTTP POST                  | **Easy**        | **Medium** | Webhook (from VK squad chat POST)       | ✅         |
| 7   | [Transition Hook Webhooks](#7-transition-hook-webhooks)       | `transition-hooks-service.ts`       | In-process `fetch()` on task status change | **Easy**        | **Medium** | Webhook (from VK transition event)      |            |
| 8   | [Lifecycle Hook Executor](#8-lifecycle-hook-executor)         | `lifecycle-hooks-service.ts`        | In-process, configurable actions           | **Medium**      | **Medium** | Webhook (from VK lifecycle event)       |            |
| 9   | [Hook Service (task state webhooks)](#9-hook-service)         | `hook-service.ts`                   | In-process `setTimeout` + HTTP POST        | **Easy**        | **Low**    | Webhook (from VK task change)           |            |
| 10  | [Daily Digest Generation](#10-daily-digest-generation)        | `digest-service.ts`                 | On-demand (API call)                       | **Medium**      | **High**   | Schedule (daily at 7 AM) + HTTP Request |            |
| 11  | [Doc Freshness Checks](#11-doc-freshness-checks)              | `doc-freshness-service.ts`          | On-demand (API call)                       | **Medium**      | **Medium** | Schedule (daily)                        |            |
| 12  | [Scheduled Deliverables](#12-scheduled-deliverables)          | `scheduled-deliverables-service.ts` | Metadata-only (no executor)                | **Medium**      | **Low**    | Schedule (per-deliverable cron)         |            |
| 13  | [PDF Report Generation](#13-pdf-report-generation)            | `pdf-report-service.ts`             | On-demand (API call)                       | **Hard**        | **Low**    | Webhook (on-demand)                     |            |
| 14  | [Notification Dispatch](#14-notification-dispatch)            | `notification-service.ts`           | In-process file-based                      | **Medium**      | **Medium** | Webhook (from VK mention/assignment)    |            |
| 15  | [Broadcast → WebSocket + Webhook](#15-broadcast-service)      | `broadcast-service.ts`              | In-process WS broadcast                    | **Hard**        | **Low**    | N/A (needs WS server)                   |            |
| 16  | [Prometheus Metrics Collection](#16-prometheus-metrics)       | `metrics/prometheus.ts`             | `setInterval` (event loop lag)             | **Hard**        | **Low**    | N/A (runtime introspection)             |            |

---

## Detailed Analysis

### 1. GitHub Issues Sync

**File:** `server/src/services/github-sync-service.ts`  
**Current:** `setInterval` polls GitHub Issues via `gh` CLI every 5 minutes. Bidirectional sync (import issues → tasks, push status back).  
**n8n approach:** Schedule trigger → GitHub node (native) → HTTP Request to VK API to create/update tasks. Outbound: VK webhook → n8n → GitHub node to update issues.  
**Benefit:** Native GitHub node in n8n has OAuth, pagination, error handling built in. Eliminates `gh` CLI dependency. Visual retry/error handling.

### 2. Stale Agent Cleanup

**File:** `server/src/services/agent-registry-service.ts`  
**Current:** `setInterval` checks for agents that haven't sent a heartbeat and marks them offline.  
**n8n approach:** Schedule trigger (every 2 min) → HTTP Request GET `/api/agents/registry` → Filter stale → HTTP Request PATCH to mark offline.  
**Benefit:** Trivial to implement. Removes background timer from server process.

### 3. Telemetry Retention Cleanup

**File:** `server/src/services/telemetry-service.ts`  
**Current:** `cleanupOldEvents()` runs once on startup. Deletes/compresses telemetry files older than retention period (default 30 days). Compresses files older than 7 days.  
**n8n approach:** Schedule trigger (daily 3 AM) → Execute Command node (or HTTP Request to a new VK cleanup endpoint).  
**Benefit:** Runs reliably on schedule instead of only at restart. Adds observability (can see last cleanup run, duration, files removed).

### 4. Failure Alert Dispatch

**File:** `server/src/services/failure-alert-service.ts`  
**Current:** Called inline when telemetry events are ingested. Checks if `run.error` or `run.completed` with `success:false`, deduplicates (5 min window), sends notification.  
**n8n approach:** VK POSTs failure events to n8n webhook → Dedup (n8n Function node with static data) → Microsoft Teams node for notification.  
**Benefit:** Decouples alerting from telemetry ingestion. Can easily add Slack, email, PagerDuty channels without touching VK code.

### 5. Clawdbot Webhook Relay

**File:** `server/src/services/clawdbot-webhook-service.ts`  
**Current:** Fire-and-forget HTTP POST to configured webhook URL on task/chat events. Single retry after 2s on failure. HMAC-SHA256 signing.  
**n8n approach:** VK emits to n8n webhook → n8n delivers to Clawdbot gateway with retry logic, signing, and dead-letter handling.  
**Benefit:** n8n provides exponential backoff, error logging, and replay. Current retry logic is basic (1 retry, 2s delay).

### 6. Squad Webhook Relay

**File:** `server/src/services/squad-webhook-service.ts`  
**Current:** Fires HTTP webhooks (generic or OpenClaw wake) when squad messages are posted. HMAC-SHA256 signing. 5s timeout.  
**n8n approach:** VK POSTs squad message to n8n webhook → n8n routes to configured destination (generic webhook or OpenClaw gateway).  
**Benefit:** Same as #5 — better retry, observability, and multi-destination routing.

### 7. Transition Hook Webhooks

**File:** `server/src/services/transition-hooks-service.ts`  
**Current:** On task status change, executes configured actions including `send-webhook` (direct `fetch()` call to configured URLs).  
**n8n approach:** VK POSTs transition event to n8n → n8n evaluates rules → routes to appropriate webhook destinations.  
**Benefit:** Move webhook routing logic out of VK. n8n can handle complex routing, transformations, and retries.

### 8. Lifecycle Hook Executor

**File:** `server/src/services/lifecycle-hooks-service.ts`  
**Current:** Configurable hooks on task lifecycle events (created, started, blocked, done, etc.). Actions: notify, log, verify checklist, emit telemetry, webhook, custom.  
**n8n approach:** VK emits lifecycle event to n8n webhook → n8n workflow with Switch node routes to appropriate action chains.  
**Benefit:** Complex hook chains become visual workflows. Non-developers can modify hook behavior.

### 9. Hook Service (task state webhooks)

**File:** `server/src/services/hook-service.ts`  
**Current:** Fires webhook POST and squad chat notifications on task state changes. Uses `setTimeout` for async execution.  
**n8n approach:** Same pattern as #7/#8 — VK emits event, n8n handles delivery.  
**Benefit:** Consolidate with #7 and #8 into a single "task event router" n8n workflow.

### 10. Daily Digest Generation

**File:** `server/src/services/digest-service.ts`  
**Current:** Generates daily digest summaries (tasks, runs, tokens, issues). Called on-demand via API — no automatic schedule.  
**n8n approach:** Schedule trigger (7 AM daily) → HTTP Request to VK digest API → Microsoft Teams node to post summary.  
**Benefit:** Automated daily delivery without relying on agent heartbeat/cron. Currently depends on VERITAS agent to trigger.

### 11. Doc Freshness Checks

**File:** `server/src/services/doc-freshness-service.ts`  
**Current:** Tracks document review dates and computes freshness scores. On-demand only.  
**n8n approach:** Schedule trigger (daily) → HTTP Request to VK doc freshness API → Filter stale docs → Notification.  
**Benefit:** Automated stale doc alerts without manual checking.

### 12. Scheduled Deliverables

**File:** `server/src/services/scheduled-deliverables-service.ts`  
**Current:** Stores deliverable metadata (schedule, last run, next run) but has **no built-in executor**. External agents must poll and execute.  
**n8n approach:** Each deliverable becomes an n8n workflow with its own schedule trigger.  
**Benefit:** n8n becomes the actual executor, replacing the need for agent polling. Each deliverable gets its own visual workflow.

### 13. PDF Report Generation

**File:** `server/src/services/pdf-report-service.ts`  
**Current:** Generates branded HTML reports from markdown. On-demand via API.  
**n8n approach:** Webhook trigger → HTTP Request to VK report API → file delivery.  
**Difficulty:** HTML generation logic is tightly coupled to VK's template system. Would need to replicate or keep calling VK API.

### 14. Notification Dispatch

**File:** `server/src/services/notification-service.ts`  
**Current:** File-based notification storage with @mention parsing. Tracks delivery status.  
**n8n approach:** VK emits notification event to n8n → n8n routes to Teams/email/push.  
**Benefit:** Multi-channel delivery without VK code changes. Currently notifications are only stored in files.

### 15. Broadcast Service

**File:** `server/src/services/broadcast-service.ts`  
**Current:** WebSocket broadcast to connected clients + webhook relay.  
**n8n approach:** Not practical — WebSocket server must stay in-process.  
**Note:** The webhook relay portion (calls to `clawdbot-webhook-service`) could be offloaded (see #5).

### 16. Prometheus Metrics Collection

**File:** `server/src/services/metrics/prometheus.ts`  
**Current:** `setInterval` measures event loop lag for Prometheus metrics.  
**n8n approach:** Not practical — requires runtime introspection of the Node.js process.

---

## Quick Wins (Recommended First Wave)

These 6 workflows can move to n8n with **minimal VK code changes** (mostly just adding a webhook POST where events already fire):

| #   | Workflow                    | Effort | Impact                                                      |
| --- | --------------------------- | ------ | ----------------------------------------------------------- |
| 1   | GitHub Issues Sync          | ~2h    | Eliminates `gh` CLI polling, adds native GitHub integration |
| 2   | Stale Agent Cleanup         | ~30min | Removes `setInterval` from server                           |
| 3   | Telemetry Retention Cleanup | ~1h    | Reliable daily cleanup vs. startup-only                     |
| 4   | Failure Alert Dispatch      | ~1h    | Multi-channel alerting, better dedup                        |
| 5   | Clawdbot Webhook Relay      | ~1h    | Proper retry/dead-letter handling                           |
| 6   | Squad Webhook Relay         | ~30min | Same as above                                               |

**Total estimated effort: ~6 hours**

### Implementation Pattern

For most offloads, the pattern is:

1. **VK side:** Add a single webhook POST to the n8n instance when the event occurs (or keep existing event and just route to n8n)
2. **n8n side:** Create workflow with Webhook trigger → processing nodes → delivery
3. **VK cleanup:** Remove the in-process `setInterval`/`setTimeout`/`fetch` logic
4. **Config:** Store n8n webhook URLs in VK settings (already has webhook URL config support)

### Consolidation Opportunity

Workflows **#5, #6, #7, #8, #9** are all variations of "on task/chat event → deliver webhook." These could be consolidated into a **single n8n "Event Router" workflow**:

```
Webhook Trigger (all VK events)
  → Switch Node (by event type)
    → Branch: task.changed → Clawdbot gateway
    → Branch: squad.message → OpenClaw wake / generic webhook
    → Branch: task.transition → configured webhook URLs
    → Branch: lifecycle.* → hook action chains
```

This would replace 5 separate VK services with 1 n8n workflow.

---

## Not Recommended for n8n

| Workflow                        | Reason                                    |
| ------------------------------- | ----------------------------------------- |
| WebSocket Broadcast (#15)       | Must be in-process (real-time WS)         |
| Prometheus Event Loop Lag (#16) | Runtime introspection, not offloadable    |
| Task Service file watcher       | Core data layer, must stay in-process     |
| Circuit Breaker logic           | Per-request middleware, latency-sensitive |

---

## Next Steps

1. **Create n8n webhook endpoints** for the 6 quick-win workflows
2. **Add VK config** for n8n webhook URL (similar to existing `VERITAS_WEBHOOK_URL`)
3. **Implement quick wins** in priority order: #3 (cleanup), #4 (alerts), #2 (stale agents), #1 (GitHub sync), #5/#6 (relays)
4. **Phase 2:** Consolidate event routing (#5-#9) into single n8n workflow
5. **Phase 3:** Automate digest (#10) and doc freshness (#11) on schedule
