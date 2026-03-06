# Orchestrator Delegation Enforcement

Prevents orchestrator agents from directly implementing work — they must delegate to sub-agents.

## Overview

When enabled, orchestrator delegation enforcement ensures the designated orchestrator agent acts as a **coordinator**, not an implementer. The orchestrator should spawn sub-agents for hands-on work (code edits, file changes, multi-step implementations) rather than doing it directly.

This enforces a separation of concerns: the orchestrator plans, prioritizes, and delegates; sub-agents execute.

## Configuration

**Settings → Enforcement → Orchestrator Delegation**

| Setting                  | Type    | Default | Description                                           |
| ------------------------ | ------- | ------- | ----------------------------------------------------- |
| `orchestratorDelegation` | boolean | `false` | Enable/disable delegation enforcement                 |
| `orchestratorAgent`      | string  | `""`    | Designated orchestrator agent name (e.g. `"veritas"`) |

### UI Configuration

1. Navigate to **Settings → Enforcement** tab
2. Scroll to the **Orchestrator Delegation** section (below the divider)
3. Toggle **Enable Delegation Enforcement**
4. Select the **Orchestrator Agent** from the dropdown (populated from enabled agents in Settings → Agents)

The section shows a status badge:

- **Active** (green shield) — enforcement enabled AND an agent is selected
- **Inactive** (gray shield) — enforcement disabled or no agent selected

> ⚠️ If delegation is enabled but no agent is selected, a warning banner appears: enforcement won't take effect until an agent is chosen.

## How It Works

### Violation Reporting API

Agents (or tooling) report delegation violations via:

```
POST /api/agent/delegation-violation
```

**Request body:**

```json
{
  "agent": "veritas",
  "action": "file_edit",
  "taskId": "task_123",
  "details": "Directly edited server/src/routes/tasks.ts"
}
```

| Field     | Required | Description                                                             |
| --------- | -------- | ----------------------------------------------------------------------- |
| `agent`   | ✅       | Agent name reporting the violation                                      |
| `action`  | ✅       | What the agent did (e.g. `file_edit`, `code_change`, `multi_step_work`) |
| `taskId`  | ❌       | Associated task ID                                                      |
| `details` | ❌       | Additional context                                                      |

**Response (enforcement enabled):**

```json
{
  "success": true,
  "enforced": true,
  "message": "Delegation violation logged for veritas: file_edit"
}
```

**Response (enforcement disabled):**

```json
{
  "success": true,
  "enforced": false,
  "message": "Delegation enforcement is disabled"
}
```

### Server-Side Behavior

When a violation is reported and enforcement is enabled:

1. **Logs a warning** — `Orchestrator delegation violation: {agent} performed {action} directly`
2. **Posts to squad chat** (if squad chat enforcement is also enabled) — a `⚠️ Delegation Violation` message from the `ENFORCEMENT` agent
3. Returns `enforced: true` so the caller knows the violation was recorded

### Toast Notifications (Client-Side)

When task operations are blocked by enforcement gates, the UI shows enhanced toast notifications:

| Gate Code                 | Title                  | Guidance                                                                            |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `ORCHESTRATOR_DELEGATION` | 🤖 Delegation Required | Orchestrator should delegate this work to a sub-agent instead of doing it directly. |

Toast notifications for enforcement gates display for **10 seconds** (vs 5s for normal errors) to ensure visibility.

### Dashboard Enforcement Indicator

The dashboard displays an **Enforcement Indicator** showing all active gates at a glance:

- Shows `{active}/{total}` gate count (e.g. `3/6`)
- Color-coded: green (all active), amber (partial), gray (none)
- Individual gate dots: green = active, gray = off
- Delegation appears as the "Delegation" dot in the indicator

## Examples

### ❌ What Gets Blocked (Violations)

- Orchestrator directly editing source code files
- Orchestrator performing multi-step implementation work
- Orchestrator making code changes instead of spawning a sub-agent

### ✅ What's Allowed

- Orchestrator reading files for context
- Orchestrator planning and creating tasks
- Orchestrator spawning sub-agents for implementation
- Orchestrator reviewing completed work
- Orchestrator updating documentation (non-code)
- Any non-orchestrator agent doing direct work (enforcement only applies to the designated orchestrator)

## Relationship to Other Enforcement Gates

Orchestrator delegation is one of six enforcement gates in Veritas Kanban:

| Gate                        | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| **Squad Chat**              | Auto-post task lifecycle events               |
| **Review Gate**             | Require 4×10 review scores before completion  |
| **Closing Comments**        | Require deliverable summary before completion |
| **Auto Telemetry**          | Emit run events on status changes             |
| **Auto Time Tracking**      | Auto-start/stop timers on status changes      |
| **Orchestrator Delegation** | Warn when orchestrator works directly         |

All gates are independently toggleable. Orchestrator delegation is unique in that it also requires selecting a specific agent — without that selection, enforcement has no effect even when toggled on.

When squad chat enforcement is also enabled, delegation violations automatically post to squad chat for team visibility.

## Data Model

In `shared/src/types/config.types.ts`:

```typescript
export interface EnforcementSettings {
  squadChat: boolean;
  reviewGate: boolean;
  closingComments: boolean;
  autoTelemetry: boolean;
  autoTimeTracking: boolean;
  orchestratorDelegation: boolean;
  orchestratorAgent?: string;
}
```

Validated server-side via Zod schema (`server/src/schemas/feature-settings-schema.ts`):

- `orchestratorDelegation`: `z.boolean().optional()`
- `orchestratorAgent`: `z.string().max(50).optional()`
