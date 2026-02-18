# Coolify Integration Guide

Veritas Kanban integrates with DigitalMeld's ops services hosted on [Coolify](https://ops.digitalmeld.cloud). This document covers all available services, integration patterns, and authentication requirements.

## Services Overview

| Service           | URL                                        | Purpose                           |
| ----------------- | ------------------------------------------ | --------------------------------- |
| **Supabase**      | `https://supabase.ops.digitalmeld.cloud`   | Database, auth, storage, realtime |
| **OpenPanel**     | `https://analytics.ops.digitalmeld.cloud`  | Web analytics dashboard           |
| **OpenPanel API** | `https://opapi.ops.digitalmeld.cloud`      | Analytics event ingestion API     |
| **n8n**           | `https://automation.ops.digitalmeld.cloud` | Workflow automation               |
| **Plane**         | `https://projects.ops.digitalmeld.cloud`   | Project management                |
| **Appsmith**      | `https://apps.ops.digitalmeld.cloud`       | Internal tool builder             |

## Integration Patterns

### Supabase (`supabase.ops.digitalmeld.cloud`)

**Integration type:** REST API + Realtime subscriptions

- **Database:** Store/query data via PostgREST (`/rest/v1/`)
- **Auth:** User authentication via `/auth/v1/`
- **Storage:** File uploads via `/storage/v1/`
- **Realtime:** WebSocket subscriptions for live updates

**Authentication:**

- `apikey` header with the project's anon or service-role key
- `Authorization: Bearer <JWT>` for authenticated requests
- Service-role key for server-side operations (bypass RLS)

**VK use cases:**

- Persist task data to a shared Supabase database
- Realtime task update subscriptions across agents
- Store task attachments in Supabase Storage

---

### OpenPanel (`analytics.ops.digitalmeld.cloud` / `opapi.ops.digitalmeld.cloud`)

**Integration type:** Event tracking API

- **Dashboard:** `analytics.ops.digitalmeld.cloud` — view analytics
- **API:** `opapi.ops.digitalmeld.cloud` — ingest events via `POST /track`

**Authentication:**

- Client ID header: `openpanel-client-id: <CLIENT_ID>`
- Optional secret: `openpanel-client-secret: <SECRET>`

**VK use cases:**

- Track task lifecycle events (created, started, completed)
- Agent usage analytics
- Dashboard engagement metrics

---

### n8n (`automation.ops.digitalmeld.cloud`)

**Integration type:** Webhooks + REST API

- **Webhooks:** Trigger n8n workflows via `POST /webhook/<path>`
- **API:** `GET/POST /api/v1/workflows`, `/api/v1/executions`

**Authentication:**

- Webhook endpoints: Usually unauthenticated or with a shared secret in the URL path
- API endpoints: `X-N8N-API-KEY: <API_KEY>` header
- Basic auth if configured

**VK use cases:**

- Trigger automation workflows on task state changes
- Offload calendar checks, transcript processing, notifications
- Orchestrate multi-service workflows (e.g., task → Slack → email)

---

### Plane (`projects.ops.digitalmeld.cloud`)

**Integration type:** REST API

- **API base:** `/api/v1/`
- Workspaces, projects, issues, cycles, modules

**Authentication:**

- API key: `X-API-Key: <PLANE_API_KEY>`
- Or OAuth2 token

**VK use cases:**

- Sync VK tasks ↔ Plane issues (bidirectional)
- Mirror project structure
- Import/export between VK and Plane

---

### Appsmith (`apps.ops.digitalmeld.cloud`)

**Integration type:** Embedded apps + REST API

- **API:** `/api/v1/` for app/page/datasource management
- **Embed:** iframe embedding for custom dashboards

**Authentication:**

- Session-based auth (cookie)
- API key for programmatic access

**VK use cases:**

- Build custom admin dashboards consuming VK API
- Create internal tools for task triage
- Embed Appsmith pages in VK UI

---

## Configuration

Services are configured in VK's `config.json` under the optional `coolify` key:

```json
{
  "repos": [...],
  "agents": [...],
  "coolify": {
    "services": {
      "supabase": {
        "url": "https://supabase.ops.digitalmeld.cloud",
        "apiKey": "eyJ..."
      },
      "openpanel": {
        "url": "https://analytics.ops.digitalmeld.cloud",
        "apiUrl": "https://opapi.ops.digitalmeld.cloud",
        "clientId": "..."
      },
      "n8n": {
        "url": "https://automation.ops.digitalmeld.cloud",
        "apiKey": "..."
      },
      "plane": {
        "url": "https://projects.ops.digitalmeld.cloud",
        "apiKey": "..."
      },
      "appsmith": {
        "url": "https://apps.ops.digitalmeld.cloud",
        "apiKey": "..."
      }
    }
  }
}
```

## Health Check

`GET /api/integrations/status` returns the status of all configured Coolify services:

```json
{
  "data": {
    "supabase": { "status": "up", "responseTimeMs": 142 },
    "openpanel": { "status": "up", "responseTimeMs": 89 },
    "n8n": { "status": "down", "responseTimeMs": 5000, "error": "timeout" },
    "plane": { "status": "unconfigured" },
    "appsmith": { "status": "unconfigured" }
  }
}
```

Status values: `up` | `down` | `unconfigured`

## Future Work

Deep integrations will be implemented as separate tasks:

- **Supabase sync:** Real-time task replication
- **OpenPanel tracking:** Automatic event emission from VK
- **n8n webhooks:** Task lifecycle → workflow triggers
- **Plane sync:** Bidirectional issue synchronization
- **Appsmith dashboards:** Embedded analytics views
