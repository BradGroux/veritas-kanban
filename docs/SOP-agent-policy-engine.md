# SOP: Agent Policy & Guard Engine

Configure and enforce access policies for agent tools and actions.

---

## Overview

The Agent Policy Engine lets you define named policies with guard rules that control what tools and actions each agent can access. Rules support three effects:

| Effect              | Behavior                                           |
| ------------------- | -------------------------------------------------- |
| `allow`             | Permit the tool/action immediately                 |
| `deny`              | Block the tool/action with a 403 response          |
| `require-approval`  | Hold the request until a human approves            |

Policies are evaluated in order of precedence. The engine supports two precedence strategies:

- **`deny-first`** — Any matching `deny` rule blocks, regardless of `allow` rules
- **`allow-first`** — First matching rule wins

---

## Prerequisites

- VK server running (v4.0+)
- API key with write access
- Understanding of which agents need restricted or expanded access

---

## Step-by-Step Procedure

### 1. List Existing Policies

Before creating, check what's already configured:

```bash
curl http://localhost:3001/api/policies \
  -H "X-API-Key: YOUR_KEY"
```

Filter by agent or project:

```bash
curl "http://localhost:3001/api/policies?agent=TARS&enabled=true" \
  -H "X-API-Key: YOUR_KEY"
```

### 2. Create a Policy

```bash
curl -X POST http://localhost:3001/api/policies \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "name": "Restrict browser access for intern agents",
    "description": "Prevent intern-level agents from using browser or fetch tools.",
    "enabled": true,
    "scope": { "agentLevel": "intern" },
    "rules": [
      { "tool": "browser", "action": "*", "effect": "deny" },
      { "tool": "web_fetch", "action": "*", "effect": "deny" }
    ],
    "precedence": "deny-first"
  }'
```

**Response:** `201` with the created policy object including its `id`.

### 3. Evaluate a Policy

Test a policy before relying on it in production:

```bash
curl -X POST http://localhost:3001/api/policies/pol_abc123/evaluate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "agent": "TARS",
    "tool": "browser",
    "action": "navigate"
  }'
```

**Response:**

```json
{
  "allowed": false,
  "effect": "deny",
  "matchedRule": { "tool": "browser", "action": "*", "effect": "deny" },
  "policyId": "pol_abc123",
  "auditId": "audit_xyz789"
}
```

### 4. Update a Policy

Enable, disable, or modify rules:

```bash
curl -X PUT http://localhost:3001/api/policies/pol_abc123 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "enabled": false
  }'
```

### 5. Delete a Policy

```bash
curl -X DELETE http://localhost:3001/api/policies/pol_abc123 \
  -H "X-API-Key: YOUR_KEY"
```

**Response:** `204 No Content`.

---

## API Endpoints

| Method   | Path                           | Description                     |
| -------- | ------------------------------ | ------------------------------- |
| `GET`    | `/api/policies`                | List all policies                |
| `POST`   | `/api/policies`                | Create a new policy              |
| `GET`    | `/api/policies/:id`            | Get a specific policy            |
| `PUT`    | `/api/policies/:id`            | Update a policy                  |
| `DELETE` | `/api/policies/:id`            | Delete a policy                  |
| `POST`   | `/api/policies/:id/evaluate`   | Evaluate a policy for an action  |

---

## Policy Object Schema

| Field         | Type     | Required | Description                                      |
| ------------- | -------- | -------- | ------------------------------------------------ |
| `name`        | string   | ✅       | Human-readable policy name                       |
| `description` | string   | ❌       | What the policy does                             |
| `enabled`     | boolean  | ✅       | Whether the policy is active                     |
| `scope`       | object   | ❌       | Targeting: `{ agent, agentLevel, project }`      |
| `rules`       | array    | ✅       | Array of guard rules (see below)                 |
| `precedence`  | enum     | ✅       | `deny-first` or `allow-first`                    |

### Guard Rule Schema

| Field    | Type   | Required | Description                                      |
| -------- | ------ | -------- | ------------------------------------------------ |
| `tool`   | string | ✅       | Tool name or `*` for any                         |
| `action` | string | ✅       | Action name or `*` for any                       |
| `effect` | enum   | ✅       | `allow`, `deny`, or `require-approval`           |

---

## Common Issues

**Policy not applying:** Check that `enabled: true` is set and the scope matches the agent making the request.

**Evaluation returns `allow` unexpectedly:** If using `allow-first`, ensure deny rules come before allow rules in the `rules` array, or switch to `deny-first` precedence.

**Audit log missing entries:** Every evaluation creates an audit entry even if not explicitly requested. Check the audit log API for policy decision history.

---

## Related Docs

- [FEATURES.md — Agent Policy Engine](./FEATURES.md#agent-policy--guard-engine)
- [API-REFERENCE.md — Policies](./API-REFERENCE.md#agent-policy-engine-apipolicies)
- [SOP: Decision Audit Trail](./SOP-decision-audit-trail.md)
