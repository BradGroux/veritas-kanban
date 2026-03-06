#!/bin/sh
# seed.sh — Populate VK demo instance with sample data via API
# Runs inside alpine/curl container — no python3, just sh + wget
set -e

API="${API_URL:-http://vk-demo:3001}"
KEY="${ADMIN_KEY:-demo-admin-key-2026}"

echo "⏳ Waiting for VK API at $API..."
for i in $(seq 1 30); do
  if wget -q --spider "$API/health" 2>/dev/null; then
    echo "✅ API is ready"
    break
  fi
  [ "$i" -eq 30 ] && echo "❌ API not ready after 60s" && exit 1
  sleep 2
done

# Check if already seeded
EXISTING=$(wget -qO- "$API/api/tasks" 2>/dev/null | grep -o '"id"' | wc -l)
if [ "$EXISTING" -gt 3 ]; then
  echo "ℹ️  Already seeded ($EXISTING tasks). Skipping."
  exit 0
fi

# Helper
post() {
  wget -qO /dev/null --post-data="$2" \
    --header="Content-Type: application/json" \
    --header="Authorization: Bearer $KEY" \
    "$API$1" 2>/dev/null || echo "  ⚠ $1 failed"
}

echo "🌱 Seeding demo data..."

# ── Tasks ─────────────────────────────────────────────────────────────
echo "  📋 Tasks..."

post "/api/tasks" '{"id":"demo_001","title":"Implement WebSocket real-time updates","type":"code","status":"done","priority":"high","project":"veritas-kanban","description":"Add WebSocket support for live board updates across connected clients.","subtasks":[{"id":"sub_001a","title":"Set up ws server","done":true},{"id":"sub_001b","title":"Client reconnection logic","done":true},{"id":"sub_001c","title":"Broadcast task mutations","done":true}],"timeTracking":{"entries":[{"id":"t_001","startTime":"2026-02-10T09:00:00Z","endTime":"2026-02-10T12:30:00Z","duration":12600}],"totalSeconds":12600}}'

post "/api/tasks" '{"id":"demo_002","title":"Build sprint planning dashboard","type":"code","status":"in-progress","priority":"high","project":"veritas-kanban","description":"Create a visual sprint planning view with capacity tracking and velocity charts.","subtasks":[{"id":"sub_002a","title":"Sprint data model","done":true},{"id":"sub_002b","title":"Velocity chart component","done":true},{"id":"sub_002c","title":"Capacity planning UI","done":false},{"id":"sub_002d","title":"Sprint retrospective view","done":false}],"timeTracking":{"entries":[{"id":"t_002","startTime":"2026-02-15T10:00:00Z","endTime":"2026-02-15T14:00:00Z","duration":14400}],"totalSeconds":14400,"isRunning":true}}'

post "/api/tasks" '{"id":"demo_003","title":"Add AI-powered task estimation","type":"research","status":"open","priority":"medium","project":"veritas-kanban","description":"Research and implement story point estimation using historical task data and LLM analysis."}'

post "/api/tasks" '{"id":"demo_004","title":"Fix memory leak in long-running agent sessions","type":"bug","status":"in-progress","priority":"critical","project":"veritas-kanban","description":"Agent sessions running >4 hours accumulate event listeners. Memory grows ~50MB/hr.","subtasks":[{"id":"sub_004a","title":"Profile heap snapshots","done":true},{"id":"sub_004b","title":"Identify listener leak source","done":true},{"id":"sub_004c","title":"Implement cleanup on disconnect","done":false}]}'

post "/api/tasks" '{"id":"demo_005","title":"Docker Compose production deployment guide","type":"documentation","status":"done","priority":"medium","project":"veritas-kanban","description":"Complete deployment guide with Docker Compose, Traefik reverse proxy, and SSL setup.","timeTracking":{"entries":[{"id":"t_005","startTime":"2026-02-12T08:00:00Z","endTime":"2026-02-12T10:00:00Z","duration":7200}],"totalSeconds":7200}}'

post "/api/tasks" '{"id":"demo_006","title":"Integrate GitHub webhook for auto-task creation","type":"code","status":"blocked","priority":"medium","project":"veritas-kanban","description":"Automatically create VK tasks from GitHub issues and PRs. Blocked: waiting on GitHub App approval.","blockedReason":"Waiting on GitHub App review (submitted Feb 14)"}'

post "/api/tasks" '{"id":"demo_007","title":"E2E test suite for critical paths","type":"code","status":"in-progress","priority":"high","project":"veritas-kanban","description":"Playwright test coverage for task CRUD, sprint management, and agent workflows."}'

post "/api/tasks" '{"id":"demo_008","title":"Research CalDAV integration for deadline sync","type":"research","status":"open","priority":"low","project":"veritas-kanban","description":"Investigate syncing task deadlines with calendar apps via CalDAV protocol."}'

post "/api/tasks" '{"id":"demo_009","title":"Audit npm dependencies for vulnerabilities","type":"operations","status":"done","priority":"high","project":"veritas-kanban","description":"Run pnpm audit, update critical packages, document remaining advisories."}'

post "/api/tasks" '{"id":"demo_010","title":"Design dark mode theme tokens","type":"code","status":"open","priority":"low","project":"veritas-kanban","description":"Define CSS custom properties for dark mode. Support system preference detection."}'

# ── Agents ────────────────────────────────────────────────────────────
echo "  🤖 Agents..."

post "/api/agents" '{"name":"VERITAS","status":"idle","model":"claude-sonnet-4-20250514","capabilities":["orchestration","task-management","code-review"],"description":"Primary orchestrator agent"}'
post "/api/agents" '{"name":"TARS","status":"working","model":"gpt-5","currentTask":"demo_002","capabilities":["frontend","react","typescript"],"description":"Frontend specialist"}'
post "/api/agents" '{"name":"CASE","status":"idle","model":"claude-sonnet-4-20250514","capabilities":["backend","api","database"],"description":"Backend engineer"}'
post "/api/agents" '{"name":"Ava","status":"offline","model":"codex","capabilities":["research","analysis","documentation"],"description":"Research and documentation agent"}'

# ── Sprints ───────────────────────────────────────────────────────────
echo "  🏃 Sprints..."

post "/api/sprints" '{"id":"sprint_demo_01","name":"Sprint 14 — Real-time & Polish","status":"active","startDate":"2026-02-10T00:00:00Z","endDate":"2026-02-24T00:00:00Z","goals":["Ship WebSocket real-time updates","Complete sprint planning dashboard","Fix critical memory leak"],"taskIds":["demo_001","demo_002","demo_004","demo_007"]}'
post "/api/sprints" '{"id":"sprint_demo_00","name":"Sprint 13 — Docs & Ops","status":"completed","startDate":"2026-01-27T00:00:00Z","endDate":"2026-02-09T00:00:00Z","goals":["Production deployment guide","Dependency audit","GitHub integration research"],"taskIds":["demo_005","demo_009","demo_006"]}'

# ── Squad Chat ────────────────────────────────────────────────────────
echo "  💬 Squad chat..."

post "/api/chat/squad" '{"agent":"VERITAS","message":"Sprint 14 kicked off. Focus areas: real-time updates, sprint dashboard, and that memory leak fix.","model":"claude-sonnet-4-20250514","tags":["sprint"]}'
post "/api/chat/squad" '{"agent":"TARS","message":"WebSocket implementation complete — all clients get live updates now. Moving to sprint dashboard.","model":"gpt-5","tags":["demo_001"]}'
post "/api/chat/squad" '{"agent":"CASE","message":"Found the memory leak — EventEmitter listeners not cleaned up on agent disconnect. Fix incoming.","model":"claude-sonnet-4-20250514","tags":["demo_004"]}'
post "/api/chat/squad" '{"agent":"VERITAS","message":"Good find CASE. demo_004 is critical path for Sprint 14. Prioritize the fix.","model":"claude-sonnet-4-20250514","tags":["demo_004"]}'
post "/api/chat/squad" '{"agent":"Ava","message":"Completed the Docker deployment guide. Covers Compose, Traefik, SSL, and backup strategies.","model":"codex","tags":["demo_005"]}'
post "/api/chat/squad" '{"agent":"TARS","message":"Sprint dashboard velocity chart is live. Starting capacity planning UI next.","model":"gpt-5","tags":["demo_002"]}'

# ── Telemetry Events ──────────────────────────────────────────────────
echo "  📊 Telemetry..."

post "/api/telemetry/events" '{"type":"run.started","taskId":"demo_001","agent":"TARS"}'
post "/api/telemetry/events" '{"type":"run.completed","taskId":"demo_001","agent":"TARS","durationMs":12600000,"success":true}'
post "/api/telemetry/events" '{"type":"run.tokens","taskId":"demo_001","agent":"TARS","model":"gpt-5","inputTokens":45000,"outputTokens":12000,"cost":0.85}'
post "/api/telemetry/events" '{"type":"run.started","taskId":"demo_004","agent":"CASE"}'
post "/api/telemetry/events" '{"type":"run.completed","taskId":"demo_005","agent":"Ava","durationMs":7200000,"success":true}'
post "/api/telemetry/events" '{"type":"run.tokens","taskId":"demo_005","agent":"Ava","model":"codex","inputTokens":28000,"outputTokens":8500,"cost":0.42}'
post "/api/telemetry/events" '{"type":"run.started","taskId":"demo_002","agent":"TARS"}'

echo ""
echo "✅ Demo seeded! Open http://localhost:${DEMO_PORT:-3099}"
