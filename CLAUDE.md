# CLAUDE.md — Agent Guidelines for Veritas Kanban

This file defines project-specific rules, context, and lessons learned for AI agents working on Veritas Kanban. Update it after every mistake, discovery, or workflow change.

> **Last updated:** 2026-03-27 (v4.0.0)
> **Freshness check:** Review monthly or after major releases

---

## Project Context

**Veritas Kanban** is an open-source AI-native task management system. It's designed for humans + AI agents to collaborate on work through a shared board, CLI, and API.

- **Primary language:** TypeScript (strict mode)
- **Monorepo:** pnpm workspaces — `server/`, `web/`, `cli/`, `shared/`, `mcp/`
- **Build:** Node 22+, pnpm 9+
- **Test:** Vitest (server), React Testing Library (web)
- **Style:** ESLint + Prettier, conventional commits

---

## Architecture Rules

### Server (Express + TypeScript)

- All routes go through centralized middleware in `server/src/middleware/`
- Auth: JWT + API keys, localhost bypass for dev (`VERITAS_AUTH_LOCALHOST_BYPASS=true`)
- Storage: Abstract via `storage/interfaces.ts` — never import `fs` directly in services
- Error handling: Use `UnauthorizedError`, `ForbiddenError`, `BadRequestError`, `InternalError`
- Pagination: Use `sendPaginated(res, items, {page, limit, total})`

### Web (React + Vite)

- State: Zustand stores, no prop drilling past 2 levels
- Realtime: WebSocket via `useRealtimeUpdates` hooks
- Styling: Tailwind CSS, component-scoped styles

### CLI (Commander.js)

- Every command mirrors an API endpoint
- JSON output via `--json` flag for scripting
- Use `chalk` for colored output

---

## Code Quality Gates

1. **Cross-model review required for all code changes**
   - If Claude writes it, GPT reviews (and vice versa)
   - See `prompt-registry/cross-model-review.md`

2. **No hardcoded secrets** — use environment variables

3. **All user input validated** — use Zod schemas

4. **Path traversal prevention** — use `validatePathSegment()` from security module

5. **Tests for new features** — aim for >80% coverage on critical paths

---

## Common Mistakes (Don't Repeat These)

### Security

- ❌ Forgot global middleware — flagged missing per-route auth that was already in `app.use()`
- ❌ Used `path.join()` without validation — allows `../` traversal
- ✅ Always check `validatePathSegment()` for any user-supplied path component

### Architecture

- ❌ Imported `fs` directly in service files — breaks storage abstraction
- ❌ Added polling when WebSocket hook existed — use `useRealtimeAgentStatus`
- ❌ Frontend interface didn't match server response (e.g., `totalAgents` vs `total` in registry stats)
- ✅ Check for existing hooks/services before creating new ones
- ✅ Server response format is source of truth — frontend interfaces must match exactly

### Multi-Agent (v2.0)

- Agent names use ALL CAPS for acronyms (VERITAS, TARS, CASE, K-2SO, R2-D2, MAX)
- Agent registry is file-based at `.veritas-kanban/agent-registry.json`
- Heartbeat timeout: 5 min (configurable). Stale check interval: 1 min
- Activity data uses `status-history` (not `activity.json`) as source of truth
- Timezone: server uses local time; clients send `?tz=<offset>` for cross-region display
- Dashboard widgets: use `onMutate` for optimistic updates (archive, status changes)

### Testing

- ❌ Used wrong field in backfilled events (`status: "success"` vs `success: true`)
- ✅ Match actual runtime schema exactly in test fixtures

---

## Conventions

### Naming

- Files: `kebab-case.ts`
- Components: `PascalCase.tsx`
- Variables/functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### Git

- Branch: `feat/description-issue-number`, `fix/description-issue-number`
- Commit: Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- PR: Always reference issue number

### Task Workflow — Veritas Protocol (MANDATORY)

Every agent working on this board MUST follow this lifecycle:

1. **Start work**: `kanban begin <id>` — sets status to in-progress, starts timer, sets agent to busy
2. **Assign yourself** (if not already): `kanban assign <id> <your-agent-name>`
3. **Break into subtasks** (3-8 per task): `kanban add-subtask <id> "subtask title"`
4. **Log decisions**: `kanban observe <id> decision "what was decided and why"`
5. **Log blockers**: `kanban block <id> "reason"` — stops timer, sets agent idle
6. **Complete work**: `kanban done <id> "summary of deliverables"` — stops timer, sets agent idle
7. **Checkpoints on long tasks** (>30 min): `POST /api/v1/tasks/<id>/checkpoint {"state": {...}}`

API base: `https://bot.srv929662.hstgr.cloud/kanban/api/v1`
CLI: `~/.local/bin/kanban` (HTTP wrapper, auto-attributes to `$KANBAN_ACTOR`)
Dashboard: https://bot.srv929662.hstgr.cloud/kanban/

**Enforcement gates are ON**: assignedTo required, closing comments required, auto time-tracking enabled.

### Additional Protocol Rules

- **Sprint tagging**: Every new task MUST be tagged with the current sprint: `kanban sprint-assign <id> <sprint-id>`
- **Dependencies**: If task B depends on task A, declare it at creation. Check `kanban deps <id>` before starting.
- **Prompt templates**: 10 registered templates available via `GET /api/v1/prompt-registry`. Use them for worker handoffs, cross-model reviews, sprint planning, standup summaries.
- **Efficient polling**: Use `GET /api/v1/changes?since=<ISO-timestamp>` instead of full task list scans. Supports ETag caching (304 responses are rate-limit-exempt).
- **Feedback**: After completing a review, rate the work: `kanban rate <id> <1-5> "comment"`

---

## File Locations

| What             | Where                                 |
| ---------------- | ------------------------------------- |
| API routes       | `server/src/routes/`                  |
| Services         | `server/src/services/`                |
| Schemas          | `server/src/schemas/`                 |
| Storage          | `server/src/storage/`                 |
| React components | `web/src/components/`                 |
| Zustand stores   | `web/src/stores/`                     |
| CLI commands     | `cli/src/commands/`                   |
| Shared types     | `shared/src/`                         |
| MCP server       | `mcp/src/`                            |
| Prompts          | `prompt-registry/`                    |
| SOPs             | `docs/SOP-*.md`                       |
| Agent registry   | `.veritas-kanban/agent-registry.json` |
| Telemetry events | `.veritas-kanban/telemetry/`          |

---

## When to Update This File

- After a bug that could have been prevented by a rule
- After discovering a pattern that should be standard
- After a cross-model review catches something systemic
- Monthly freshness review (add to calendar)

---

## Credit

Structure inspired by Anthropic's CLAUDE.md convention and [BoardKit Orchestrator](https://github.com/BoardKit/orchestrator) by Monika Voutov.
