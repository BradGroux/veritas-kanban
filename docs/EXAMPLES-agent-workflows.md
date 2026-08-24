# Real-World Agent Workflow Examples

Steal these end-to-end flows when building your own automations. Each example shows the goal, prompts, API/CLI calls, and outputs we expect.

---

## 1. Feature Development Sprint (BrainMeld PRD excerpt)

**Goal:** Build "Lessons Learned" field.

1. **Create task**
   ```bash
   vk create "Feature: Lessons Learned field" --project veritas-kanban --type feature --priority medium
   ```
2. **Prompt (worker)**
   ```
   Implement markdown lessonsLearned field on tasks (UI + API). Include migration + docs. Run the task's configured review gate, if any.
   ```
3. **Workflow**
   - `vk begin <id>`
   - Implement server -> shared -> web changes
   - Update docs + tests
   - `vk done <id> "Added lessons learned field"`
4. **Outputs**
   - Task summary with PR link
   - Lessons Learned comment describing future usage

---

## 2. Bug Fix (Archive bulk action)

**Goal:** Sprint archive button fails.

1. Create bug task referencing GitHub Issue #86.
2. Subtasks:
   - Reproduce in dev
   - Inspect network requests
   - Patch bulk archive handler
   - Add regression test (Playwright)
3. CLI flow: `vk begin`, fix, `vk done "Bulk archive now calls API"`
4. Focused tests verify UI + API parity; add independent review when required.

---

## 3. Documentation Update

**Goal:** Add sanity checks to Getting Started.

1. Task description includes sections to cover (API, UI, agent pickup).
2. Agent edits `docs/GETTING-STARTED.md` + `docs/TROUBLESHOOTING.md` references.
3. Completion summary links to diff + screenshot placeholders.

---

## 4. Security Audit (RF-002 style)

**Goal:** Run a focused security audit on the repository.

1. Task -> `type=security`, `project=veritas-kanban`.
2. Subtasks: scope, inspect trust boundaries, validate findings, compile evidence, create issues.
3. Use the security-review prompt and save durable results to the task's declared artifact path.
4. Deliverables: Markdown report, HTML deck, GitHub issues.

---

## 5. Content Production (Podcast clip → LinkedIn post)

1. Task `type=content` with acceptance criteria (summary, caption, schedule time).
2. Agent fetches transcript, writes summary, drafts LinkedIn copy, saves assets to `projects/start-small-think-big/...`.
3. Completion summary includes copy + asset path; lessons learned capture platform insights.

---

## 6. Research & Report (Champions)

1. Task `type=research`, project `social`, sprint `CHAMP-02`.
2. Prompt includes dossier template, required sources, HTML deck requirement.
3. Agent workflow: gather sources, write Markdown, generate HTML via script, `brain-write.sh` to mirror.
4. Final comment: TL;DR + links to both artifacts.

---

## Pattern to Copy

For any workflow:

1. **Task** with crystal-clear done definition.
2. **Prompt** stored in registry.
3. **API/CLI** calls scripted (vk begin/done, time tracking, status updates).
4. **Artifacts** saved to predictable paths and mirrored to Brain/engram if needed.
5. **Focused review** when the task or configured governance policy requires it.
6. **Lessons learned** field updated for systemic knowledge.

Use these recipes as seeds for your own automation playbooks.

---

## 7. Workflow Engine Pipeline

**Goal:** Automate plan → implement → test → review with retry policies.

1. Create `.veritas-kanban/workflows/feature-dev.yml` with planner, developer, and tester agents.
2. Start via API: `POST /api/workflows/feature-dev/runs`
3. Monitor live in the Workflows tab — each step shows status, duration, and output preview.
4. Gate steps block until quality checks pass or a human approves.

See [WORKFLOW-GUIDE.md](WORKFLOW-GUIDE.md) for full YAML examples.

---

## 8. Using Task Dependencies

**Goal:** Ensure backend API is complete before frontend work starts.

1. Create `US-100 "Build REST API"` and `US-101 "Build React UI"`.
2. Set dependency: `US-101` depends_on `US-100`.
3. The dependency badge on `US-101` shows it's blocked until `US-100` is done.
4. Query the full graph: `GET /api/tasks/US-101/dependencies`

---

## 9. Crash-Recovery Checkpointing

**Goal:** Resume long-running agent work after a crash.

```bash
# Save checkpoint mid-work
curl -X POST http://localhost:3001/api/tasks/US-42/checkpoint \
  -H "Content-Type: application/json" \
  -d '{"state":{"step":3,"completed":["auth","db"],"notes":"Working on API layer"}}'

# After restart, resume from checkpoint
CHECKPOINT=$(curl -s http://localhost:3001/api/tasks/US-42/checkpoint)
# Feed $CHECKPOINT into agent prompt for continuity

# Clean up after completion
curl -X DELETE http://localhost:3001/api/tasks/US-42/checkpoint
```

---

## 10. Observational Memory for Cross-Agent Learning

**Goal:** Capture architectural decisions so future agents don't repeat exploration.

```bash
# Log a decision
curl -X POST http://localhost:3001/api/observations \
  -H "Content-Type: application/json" \
  -d '{"taskId":"US-42","type":"decision","content":"Chose WebSocket over SSE for real-time updates — lower latency, bidirectional","importance":9}'

# Future agent searches before making the same decision
curl "http://localhost:3001/api/observations/search?query=websocket+vs+sse"
```

---

## 11. Agent Policy Evaluation (v4.0)

**Goal:** Restrict an agent from deleting production tasks.

```bash
# Create a deny-first policy
curl -X POST http://localhost:3001/api/policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "no-delete-production",
    "description": "Prevent agents from deleting tasks in production projects",
    "scope": {"project": "production"},
    "rules": [{"tool": "task.delete", "action": "deny", "reason": "Production tasks require human approval for deletion"}],
    "precedence": "deny-first"
  }'

# Test before deploying
curl -X POST http://localhost:3001/api/policies/POLICY_ID/evaluate \
  -H "Content-Type: application/json" \
  -d '{"agent": "codex-1", "tool": "task.delete", "context": {"project": "production"}}'
```

---

## 12. Behavioral Drift Monitoring (v4.0)

**Goal:** Detect when an agent's task completion rate drops.

```bash
# Configure a drift monitor
curl -X POST http://localhost:3001/api/drift \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "TARS",
    "metric": "completion_rate",
    "baseline": 0.85,
    "warningThreshold": 0.70,
    "alertThreshold": 0.50
  }'

# Check drift status across all agents
curl -s http://localhost:3001/api/drift | jq '.data[] | {agent, metric, status}'
```

---

## 13. Decision Audit Trail (v4.0)

**Goal:** Log a significant architectural decision with assumptions for future reference.

```bash
# Record a decision
curl -X POST http://localhost:3001/api/decisions \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "US-200",
    "agent": "VERITAS",
    "decision": "Use file-based storage instead of SQLite for v4.0",
    "confidence": 0.8,
    "evidence": ["Current scale is <1000 tasks", "File ops are simpler to debug", "No migration path needed"],
    "assumptions": ["Scale stays under 10k tasks", "Single-instance deployment"]
  }'

# Later: record what happened
curl -X POST http://localhost:3001/api/decisions/DECISION_ID/outcome \
  -H "Content-Type: application/json" \
  -d '{"outcome": "File storage held up well through v4.0 launch. Assumption about scale still valid at ~350 tasks."}'
```
