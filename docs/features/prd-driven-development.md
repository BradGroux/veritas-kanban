# PRD-Driven Autonomous Development

A systematic approach to autonomous AI-driven feature development that transforms product requirements into working code through iterative, quality-gated execution.

> 👤 **For human users:** This guide shows you how to set up PRD-driven autonomous development with your own AI agents.
>
> 🤖 **For AI agents:** This guide contains the procedures you need to execute autonomous development workflows using VK's API.

## Overview

PRD-Driven Autonomous Development is a pattern for building software where an AI agent reads a product requirements document (PRD), breaks it into implementable user stories, autonomously codes each story with quality gates, commits the work, and iterates until all stories are complete. Each iteration runs in fresh context, with memory preserved through git history, progress files, and the PRD itself.

Veritas Kanban natively supports the complete workflow—from PRD creation to autonomous implementation—without requiring external orchestration tools.

**Core benefits:**

- **Predictable quality** — Enforcement gates (reviewGate, closingComments, autoTelemetry) ensure deterministic quality checks
- **Compound learning** — Progress files capture lessons; later iterations benefit from earlier ones
- **Fresh context per iteration** — Each story starts clean; no context window bloat
- **Real-time visibility** — Squad Chat shows exactly what agents are doing each iteration
- **Full audit trail** — Git history + telemetry + time tracking = complete execution record

## How VK Supports This Pattern

Veritas Kanban provides native infrastructure for every phase of autonomous development:

| Phase                    | VK Feature                   | What It Does                                                   |
| ------------------------ | ---------------------------- | -------------------------------------------------------------- |
| **Requirements**         | Task Templates               | Define PRD-style templates with user stories as subtasks       |
| **Story Breakdown**      | Subtasks & Dependencies      | Break PRDs into implementable stories with acceptance criteria |
| **Autonomous Execution** | Sub-agent orchestration      | `sessions_spawn` for fresh-context iterations per story        |
| **Quality Gates**        | Enforcement Gates            | reviewGate (4×10 scoring), closingComments, autoTelemetry      |
| **Real-Time Monitoring** | Squad Chat                   | Live narrative of agent progress, step-by-step                 |
| **Memory Persistence**   | Git Workflow + Time Tracking | Worktree isolation, automatic commits, full time accounting    |
| **Success Tracking**     | Telemetry & Analytics        | Run success rates, token usage, duration metrics per story     |
| **Error Learning**       | Error Learning Service       | Record failures, similarity search for recurring issues        |

---

## Setup (For Humans)

### Prerequisites

Before setting up PRD-driven autonomous development:

1. **VK server running** — `http://localhost:3001` (or your configured port)
2. **API access** — API key configured (`VERITAS_API_KEY` or `VERITAS_ADMIN_KEY`)
3. **Git repository** — Your project is a git repository
4. **Quality checks** — You have automated checks (tests, linters, typecheck)
5. **OpenClaw integration** (optional) — For `sessions_spawn` sub-agent orchestration

### Step 1: Create a PRD Task Template

**Via UI (recommended for first time):**

1. Navigate to `/templates` in your VK instance
2. Click "Create Template"
3. Fill in:
   - **Name:** `Feature Development PRD`
   - **Category:** `development`
   - **Title template:** `Feature: {{feature_name}}`
   - **Description template:**

     ```markdown
     ## Goal

     {{goal_description}}

     ## User Stories

     See subtasks below — each story is independently implementable.

     ## Acceptance Criteria

     - All user stories completed with passing tests
     - Code review score ≥ 8/10 in all dimensions
     - Documentation updated
     - Zero security vulnerabilities introduced
     ```
4. Add subtask templates:
   - `US-001: {{story_1}}`
   - `US-002: {{story_2}}`
   - `US-003: {{story_3}}`
   - (add more as needed)
5. Set default agent (e.g., `veritas`, `codex`)
6. Enable enforcement gates:
   - ✅ reviewGate
   - ✅ closingComments
   - ✅ autoTelemetry
7. Save template

**Via API:**

```bash
curl -X POST http://localhost:3001/api/templates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "name": "Feature Development PRD",
    "category": "development",
    "taskDefaults": {
      "type": "code",
      "priority": "medium",
      "agent": "veritas"
    },
    "subtaskTemplates": [
      {"title": "US-001: {{story_1}}", "order": 0},
      {"title": "US-002: {{story_2}}", "order": 1},
      {"title": "US-003: {{story_3}}", "order": 2}
    ],
    "enforcementGates": {
      "reviewGate": true,
      "closingComments": true,
      "autoTelemetry": true
    }
  }'
```

### Step 2: Create Progress File Location

Create a workspace directory for progress tracking:

```bash
mkdir -p .veritas-kanban
touch .veritas-kanban/progress.md
```

This file will be shared across all iterations for compound learning.

### Step 3: Configure Agent Prompt

Create an agent prompt file (or store in your orchestration system):

```markdown
# Agent Prompt: PRD-Driven Autonomous Development

TASK: {{task.id}} — {{task.title}}

PRD:
{{task.description}}

USER STORIES (implement in order):
{{task.subtasks}}

PROGRESS FILE: .veritas-kanban/progress.md

INSTRUCTIONS:

1. Read progress file (previous iterations' learnings)
2. Pick next incomplete user story from subtasks
3. Implement story with tests
4. Run quality checks: typecheck, lint, unit tests
5. If checks fail, fix and retry (max 2 attempts)
6. If checks pass, commit: "feat(story-id): description"
7. Append to progress file: what you did, what you learned
8. Mark subtask complete via API
9. Post to Squad Chat at each major step
10. Repeat until all stories done

QUALITY GATES (enforced by reviewGate):

- Code: Well-structured, idiomatic, no duplication (≥8/10)
- Docs: Inline comments, README updates (≥8/10)
- Safety: Input validation, error handling, no secrets (≥8/10)
- Testing: Unit tests, edge cases covered (≥8/10)

VK_API: http://localhost:3001
SQUAD_CHAT_ENDPOINT: POST /api/chat/squad

When all subtasks complete:
POST /api/tasks/{{task.id}}/complete
-d '{"summary":"Completed {{task.title}} — X stories, all tests passing"}'
```

### Step 4: Test the Workflow

Create a test PRD task:

```bash
# Via CLI
vk create "Feature: Test PRD Workflow" \
  --template "Feature Development PRD" \
  --vars '{
    "feature_name":"Test PRD Workflow",
    "goal":"Verify PRD-driven autonomous development setup",
    "story_1":"Create hello-world function",
    "story_2":"Add unit tests",
    "story_3":"Update documentation"
  }'

# Start autonomous execution
vk automation:start <task-id>
```

Monitor via Squad Chat at `http://localhost:3001/squad` (if available) or Activity page.

---

## Execution Workflow (For AI Agents)

> 🤖 **AI Agents:** This section contains the step-by-step procedure for executing PRD-driven autonomous development.

### Agent Execution Loop

When assigned a PRD task (identified by subtasks and enforcement gates), follow this loop:

#### Pre-Execution Setup

1. **Fetch task details:**

   ```bash
   GET http://localhost:3001/api/tasks/{TASK_ID}
   ```

2. **Verify it's a PRD task:**
   - Check: `task.subtasks.length > 0`
   - Check: `task.enforcementGates.reviewGate === true`

3. **Announce start to Squad Chat:**

   ```bash
   POST http://localhost:3001/api/chat/squad
   {
     "agent": "YOUR_AGENT_NAME",
     "message": "Starting {{task.title}} — {{task.subtasks.length}} stories",
     "model": "YOUR_MODEL_NAME",
     "tags": ["prd-driven", "autonomous"]
   }
   ```

4. **Start time tracking:**

   ```bash
   POST http://localhost:3001/api/tasks/{TASK_ID}/time/start
   ```

5. **Emit telemetry start:**
   ```bash
   POST http://localhost:3001/api/telemetry/events
   {
     "type": "run.started",
     "taskId": "{TASK_ID}",
     "agent": "YOUR_AGENT_NAME"
   }
   ```

#### Iteration Loop (For Each Story)

**Step 1: Read progress file**

```bash
# Check if progress file exists
if [ -f .veritas-kanban/progress.md ]; then
  PROGRESS=$(cat .veritas-kanban/progress.md)
fi
```

Parse previous learnings to inform current implementation.

**Step 2: Find next incomplete story**

```bash
GET http://localhost:3001/api/tasks/{TASK_ID}

# Filter subtasks where completed === false
# Pick first incomplete subtask
CURRENT_STORY_ID=$(jq -r '.data.subtasks[] | select(.completed == false) | .id' | head -1)
CURRENT_STORY_TITLE=$(jq -r '.data.subtasks[] | select(.id == "'$CURRENT_STORY_ID'") | .title')
```

If no incomplete stories remain, proceed to **Completion** section.

**Step 3: Announce story start**

```bash
POST http://localhost:3001/api/chat/squad
{
  "agent": "YOUR_AGENT_NAME",
  "message": "{{CURRENT_STORY_TITLE}}: Implementing...",
  "model": "YOUR_MODEL_NAME",
  "tags": ["prd-driven"]
}
```

**Step 4: Implement the story**

Write code to satisfy the story's requirements. Consider:

- Acceptance criteria from the story description
- Patterns and learnings from progress file
- Code quality gates (structure, idioms, no duplication)

**Step 5: Write tests**

Create unit tests covering:

- Happy path (success case)
- Edge cases
- Error handling
- Minimum 80% coverage (configurable)

**Step 6: Run quality checks**

Execute quality checks in order (fail fast):

```bash
# Type check
npm run typecheck || pnpm typecheck || tsc --noEmit
EXIT_CODE_TYPECHECK=$?

# Lint
npm run lint || pnpm lint || eslint .
EXIT_CODE_LINT=$?

# Test
npm test || pnpm test || jest
EXIT_CODE_TEST=$?
```

**If any check fails:**

```bash
# Announce failure
POST http://localhost:3001/api/chat/squad
{
  "agent": "YOUR_AGENT_NAME",
  "message": "{{CURRENT_STORY_TITLE}}: Quality check failed (typecheck: {{EXIT_CODE_TYPECHECK}}, lint: {{EXIT_CODE_LINT}}, test: {{EXIT_CODE_TEST}}) — fixing...",
  "model": "YOUR_MODEL_NAME",
  "tags": ["prd-driven", "retry"]
}

# Fix issues and retry (max 2 attempts)
# If 2 failures, escalate:
POST http://localhost:3001/api/tasks/{TASK_ID}
{
  "status": "blocked",
  "blockReason": "Quality checks failing after 2 attempts — human review needed"
}

POST http://localhost:3001/api/tasks/{TASK_ID}/comments
{
  "text": "Story {{CURRENT_STORY_TITLE}} blocked: quality checks failing. Errors:\n\n{{ERROR_DETAILS}}",
  "author": "YOUR_AGENT_NAME"
}

# Exit loop
exit 1
```

**Step 7: Commit changes**

```bash
git add .
git commit -m "feat({{CURRENT_STORY_ID}}): {{CURRENT_STORY_TITLE}}"
COMMIT_HASH=$(git rev-parse --short HEAD)

# Announce commit
POST http://localhost:3001/api/chat/squad
{
  "agent": "YOUR_AGENT_NAME",
  "message": "{{CURRENT_STORY_TITLE}}: Tests passing — committed ({{COMMIT_HASH}})",
  "model": "YOUR_MODEL_NAME",
  "tags": ["prd-driven", "commit"]
}
```

**Step 8: Update progress file**

```bash
cat >> .veritas-kanban/progress.md << EOF

## Iteration {{ITERATION_NUM}}: {{CURRENT_STORY_ID}} ({{CURRENT_STORY_TITLE}})
**Started:** $(date -u +"%Y-%m-%d %H:%M")
**Duration:** {{ELAPSED_TIME}}
**Commit:** {{COMMIT_HASH}}

**What I did:**
- {{IMPLEMENTATION_SUMMARY}}

**What I learned:**
- {{KEY_LEARNINGS}}

**Status:** ✅ Complete

---

EOF
```

**Step 9: Mark subtask complete**

```bash
POST http://localhost:3001/api/tasks/{TASK_ID}/subtasks/{CURRENT_STORY_ID}/complete

# Announce completion
POST http://localhost:3001/api/chat/squad
{
  "agent": "YOUR_AGENT_NAME",
  "message": "{{CURRENT_STORY_TITLE}}: Complete — marked as done",
  "model": "YOUR_MODEL_NAME",
  "tags": ["prd-driven", "complete"]
}
```

**Step 10: Repeat**

Loop back to **Step 2** to find the next incomplete story.

#### Completion Phase

When all subtasks are complete:

**Step 1: Submit review scores**

```bash
POST http://localhost:3001/api/tasks/{TASK_ID}/review
{
  "decision": "approved",
  "scores": {
    "code": {{CODE_SCORE}},
    "docs": {{DOCS_SCORE}},
    "safety": {{SAFETY_SCORE}},
    "testing": {{TESTING_SCORE}}
  },
  "summary": "All quality gates passed. {{TOTAL_STORIES}} stories completed."
}
```

**Scoring guidelines:**

- **Code (8-10):** Well-structured, idiomatic, no duplication
- **Docs (8-10):** Inline comments, README updates, clear explanations
- **Safety (8-10):** Input validation, error handling, no hardcoded secrets
- **Testing (8-10):** Unit tests, edge cases, ≥80% coverage

**Step 2: Add closing comment**

```bash
POST http://localhost:3001/api/tasks/{TASK_ID}/comments
{
  "text": "Completed {{task.title}}:\n{{STORY_SUMMARY_LIST}}\n\nAll tests passing, security review clean.",
  "author": "YOUR_AGENT_NAME"
}
```

**Step 3: Finalize progress file**

```bash
cat >> .veritas-kanban/progress.md << EOF

## Summary
**Total duration:** {{TOTAL_ELAPSED}}
**Stories completed:** {{COMPLETED_COUNT}}/{{TOTAL_COUNT}}
**Commits:** {{COMMIT_COUNT}}
**Quality gates:** All passed
**Final review score:** Code {{CODE_SCORE}}, Docs {{DOCS_SCORE}}, Safety {{SAFETY_SCORE}}, Testing {{TESTING_SCORE}}
EOF
```

**Step 4: Stop time tracking**

```bash
POST http://localhost:3001/api/tasks/{TASK_ID}/time/stop
```

**Step 5: Emit telemetry completion**

```bash
POST http://localhost:3001/api/telemetry/events
{
  "type": "run.completed",
  "taskId": "{TASK_ID}",
  "agent": "YOUR_AGENT_NAME",
  "durationMs": {{DURATION_MS}},
  "success": true
}

# Report token usage
POST http://localhost:3001/api/telemetry/events
{
  "type": "run.tokens",
  "taskId": "{TASK_ID}",
  "agent": "YOUR_AGENT_NAME",
  "model": "YOUR_MODEL_NAME",
  "inputTokens": {{INPUT_TOKENS}},
  "outputTokens": {{OUTPUT_TOKENS}},
  "cacheTokens": {{CACHE_TOKENS}},
  "cost": {{COST_USD}}
}
```

**Step 6: Mark task complete**

```bash
POST http://localhost:3001/api/tasks/{TASK_ID}/complete
{
  "summary": "Completed {{task.title}} — {{COMPLETED_COUNT}} stories, all tests passing"
}

# Announce completion
POST http://localhost:3001/api/chat/squad
{
  "agent": "YOUR_AGENT_NAME",
  "message": "{{task.title}}: Complete — {{COMPLETED_COUNT}} stories, {{COMMIT_COUNT}} commits, {{TOTAL_ELAPSED}}",
  "model": "YOUR_MODEL_NAME",
  "tags": ["prd-driven", "complete"]
}
```

#### Error Handling

**On API errors:**

```bash
# Log error details
POST http://localhost:3001/api/errors
{
  "taskId": "{TASK_ID}",
  "errorType": "api_error",
  "context": "{{API_ENDPOINT}}",
  "resolution": "{{ATTEMPTED_FIX}}"
}

# Notify via Squad Chat
POST http://localhost:3001/api/chat/squad
{
  "agent": "YOUR_AGENT_NAME",
  "message": "ERROR: API call failed ({{API_ENDPOINT}}) — {{ERROR_MESSAGE}}",
  "model": "YOUR_MODEL_NAME",
  "tags": ["prd-driven", "error"]
}
```

**On quality check failures (after 2 retries):**

Block task and escalate to human (see Step 6 retry logic above).

**On git conflicts:**

```bash
POST http://localhost:3001/api/tasks/{TASK_ID}
{
  "status": "blocked",
  "blockReason": "Git merge conflict — human resolution needed"
}
```

---

## Example: Building an OAuth2 Feature

### Human Setup

**Step 1: Create PRD task**

Via UI or CLI:

```bash
vk create "Feature: OAuth2 Social Login" \
  --template "Feature Development PRD" \
  --vars '{
    "feature_name": "OAuth2 Social Login",
    "goal": "Enable users to log in with Google, GitHub, or Microsoft accounts",
    "story_1": "Google OAuth provider setup",
    "story_2": "GitHub OAuth provider setup",
    "story_3": "Microsoft OAuth provider setup",
    "story_4": "Unified OAuth callback handler",
    "story_5": "User account linking logic",
    "story_6": "OAuth settings UI"
  }'
```

**Step 2: Start autonomous agent**

```bash
# Get task ID from output above (e.g., OAUTH-042)
vk automation:start OAUTH-042
```

**Step 3: Monitor progress**

- Watch Squad Chat for real-time updates
- Check Activity page for status changes
- Review commits in task detail panel

**Step 4: Review and merge**

When agent completes:

1. Open task detail panel → Diff tab
2. Review all commits
3. Check review scores (should be ≥ 8/10)
4. Approve via Review panel
5. Click "Merge"

### Agent Execution

Agent receives task `OAUTH-042` and follows the execution workflow:

**Iteration 1: Google OAuth setup**

- Read progress file (empty on first run)
- Implement Google OAuth config
- Write tests
- Run quality checks (pass)
- Commit: `feat(US-001): Google OAuth provider setup`
- Update progress file with learnings
- Mark US-001 complete
- **Duration:** 8m 32s

**Iteration 2: GitHub OAuth setup**

- Read progress file (learns about HTTPS redirect URIs from iteration 1)
- Implement GitHub OAuth config
- Reuse redirect handler pattern from US-001
- Write tests
- Run quality checks (pass)
- Commit: `feat(US-002): GitHub OAuth provider setup`
- Update progress file
- Mark US-002 complete
- **Duration:** 6m 18s

**Iterations 3-6:** (Microsoft OAuth, callback handler, account linking, settings UI)

**Completion:**

- All 6 stories complete
- Submit review scores (Code: 9, Docs: 8, Safety: 10, Testing: 9)
- Add closing comment
- Emit telemetry (156k tokens, 43m duration)
- Mark task complete

### Expected Result

```
Feature: OAuth2 Social Login (6 stories)
├─ 6 commits (one per story)
├─ 27 files changed
├─ 43 minutes total duration
├─ 156k tokens consumed
├─ 100% test coverage
└─ Zero security issues
```

---

## Configuration Tips

### 1. Enable All Enforcement Gates

For autonomous work, enable all gates to ensure quality:

```json
{
  "enforcementGates": {
    "reviewGate": true,
    "closingComments": true,
    "autoTelemetry": true,
    "timeTracking": true
  }
}
```

### 2. Structure PRDs with Clear Acceptance Criteria

Every story should have measurable acceptance criteria:

```markdown
## User Story: US-001

**Title:** Google OAuth provider setup

**Acceptance Criteria:**

- OAuth2 config created with client ID/secret from environment
- Redirect URI handler implemented at `/auth/google/callback`
- Token exchange logic with error handling for invalid codes
- Unit tests covering success and failure cases
- README updated with Google OAuth setup instructions
```

### 3. Use Progress Files for Compound Learning

The progress file is the agent's memory across iterations:

**What to capture:**

- Implementation decisions and rationale
- Technical gotchas or edge cases discovered
- Patterns that worked well
- Things to avoid in future stories

**Example entry:**

```markdown
## Iteration 1: US-001 (Google OAuth setup)

**What I learned:**

- Google requires HTTPS redirect URIs in production (localhost OK in dev)
- Token expiry is 1 hour — need refresh token logic for long sessions
- State parameter is critical for CSRF protection — never skip it
- Scopes: `email` and `profile` are sufficient for basic login
```

Later stories can reference these learnings.

### 4. Tune Agent Prompts for Deterministic Quality

Make quality checks explicit and deterministic:

```markdown
QUALITY CHECKS (run before commit):

1. pnpm typecheck — must exit 0
2. pnpm lint — must exit 0
3. pnpm test — must exit 0, coverage ≥ 80%

If any check fails:

- Read the error output carefully
- Fix the specific issue mentioned
- Re-run ALL checks (not just the one that failed)
- If 2 sequential failures on same story, escalate to human

DO NOT commit if any check fails.
```

### 5. Set Telemetry Tags for Analysis

Tag autonomous runs for later analysis:

```json
{
  "telemetryTags": ["autonomous", "prd-driven", "oauth"]
}
```

**Query later:**

```bash
# Get all autonomous development runs
GET /api/telemetry/events?tags=autonomous&type=run.completed

# Analyze success rate for PRD-driven runs
GET /api/metrics/success-rate?tags=prd-driven

# Compare OAuth feature implementations
GET /api/telemetry/events?tags=oauth&type=run.tokens
```

### 6. Configure Retry and Escalation Policies

Set clear thresholds for when agent should retry vs. escalate:

**Retry scenarios:**

- Quality checks fail (max 2 retries per story)
- API rate limit hit (exponential backoff)
- Transient test failures (flaky tests)

**Escalation scenarios:**

- 2 consecutive quality check failures on same story
- Git merge conflicts
- API authentication errors
- Ambiguous requirements in story

### 7. Set Up Squad Chat Monitoring

Squad Chat provides real-time visibility — ensure it's configured:

```bash
# Test Squad Chat posting
curl -X POST http://localhost:3001/api/chat/squad \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "agent": "test-agent",
    "message": "Squad Chat test",
    "model": "test",
    "tags": ["test"]
  }'
```

If successful, your VK instance supports Squad Chat monitoring.

---

## When to Use

### ✅ Use PRD-Driven Autonomous Development When:

- **Requirements are clear** — Well-defined user stories with measurable acceptance criteria
- **Stories are independent** — Each story can be implemented without complex dependencies on others
- **Quality is measurable** — You have deterministic quality checks (tests, linters, typecheck)
- **Iterations are small** — Each story is ≤30 minutes of work
- **Memory needs are low** — Context carries via git history + progress files, not multi-turn chat
- **You want reproducibility** — Same PRD + same instructions should produce consistent results
- **Parallel execution is possible** — Multiple agents can work on different features simultaneously

### ❌ Don't Use When:

- **Requirements are vague** — "Make it better" or "Add some features" without specifics
- **Stories are tightly coupled** — Story 3 can't start until Story 2's implementation details are known
- **Quality is subjective** — No automated checks; human judgment required for every decision
- **Iterations are long** — Stories require hours of work with many back-and-forth design decisions
- **High context needs** — Agent must remember nuanced architectural decisions across many turns
- **Rapid exploration** — You're prototyping and pivoting frequently on requirements
- **High-risk changes** — Database migrations, authentication changes, or anything that could cause data loss

### When NOT to Use (Detailed)

**Exploratory development:**

If you're not sure what you want, or you're rapidly iterating on a prototype, use interactive chat-based development instead. PRD-driven autonomous development assumes you know the destination—it's optimized for execution, not exploration.

**Complex architectural decisions:**

Stories that require weighing multiple design tradeoffs (e.g., "Design the data model for multi-tenancy") benefit from interactive conversation, not autonomous iteration. Use PRD-driven development _after_ architecture is settled.

**High-risk changes:**

Database migrations, authentication changes, or anything that could cause data loss should have human oversight at every step. Don't run these autonomously.

**Research tasks:**

If the task is "Research the best approach to X," that's not a PRD—that's an exploratory task. Use research-type tasks with interactive agents instead.

---

## Comparison to Interactive Development

| Dimension           | PRD-Driven Autonomous                        | Interactive Chat-Based                           |
| ------------------- | -------------------------------------------- | ------------------------------------------------ |
| **Context**         | Fresh per iteration                          | Continuous conversation                          |
| **Memory**          | Git + progress files                         | LLM context window                               |
| **Speed**           | Parallel/batch-able                          | Sequential, human-paced                          |
| **Oversight**       | Quality gates only                           | Human in the loop constantly                     |
| **Best for**        | Known requirements, repetitive patterns      | Exploration, complex decisions                   |
| **Failure mode**    | Predictable (quality gate rejects)           | Unpredictable (context drift, hallucination)     |
| **Token usage**     | High (fresh context per iteration)           | Moderate (continuous context)                    |
| **Scalability**     | High (multiple agents on different features) | Low (one human can only guide one agent at once) |
| **Audit trail**     | Complete (git + telemetry + time tracking)   | Incomplete (chat logs only)                      |
| **Reproducibility** | High (same PRD → same result)                | Low (different conversation → different result)  |

### Hybrid Approach (Recommended)

Use interactive development to design and build the first iteration, then use PRD-driven autonomous development to replicate the pattern across multiple similar features.

**Example workflow:**

1. **Iteration 1 (interactive):** Build OAuth2 for Google
   - Human guides architectural decisions
   - Agent asks clarifying questions
   - Human reviews each commit
   - Establish patterns and conventions

2. **Capture the pattern:** Document the approach in a PRD template
   - What worked well (design decisions)
   - What to avoid (gotchas discovered)
   - Code patterns to follow
   - Quality thresholds

3. **Iterations 2+ (autonomous):** Add GitHub, Microsoft, Twitter OAuth
   - Agent follows established patterns
   - Quality gates enforce consistency
   - Human reviews only at completion
   - Parallelizable (multiple agents on different providers)

**Result:** 4x faster delivery, consistent quality, human oversight where it matters.

---

## Troubleshooting

### Agent Not Marking Subtasks Complete

**Symptom:** Agent completes story but doesn't mark subtask as complete.

**Check:**

1. API endpoint format: `POST /api/tasks/{TASK_ID}/subtasks/{SUBTASK_ID}/complete`
2. Subtask ID is correct (check `GET /api/tasks/{TASK_ID}` response)
3. Authorization header is present

**Fix:** Ensure agent has correct subtask ID from task fetch.

### Quality Checks Failing Repeatedly

**Symptom:** Agent retries same story 3+ times with same errors.

**Check:**

1. Error messages from quality checks
2. Whether agent is reading error output
3. Whether fixes are addressing root cause

**Fix:** Improve agent prompt to parse error messages and make targeted fixes.

### Progress File Not Growing

**Symptom:** Progress file exists but has no entries after multiple iterations.

**Check:**

1. File path: `.veritas-kanban/progress.md`
2. File permissions (agent can write)
3. Agent prompt includes progress file update step

**Fix:** Verify agent has write access and is executing Step 8 (update progress file).

### Squad Chat Silent

**Symptom:** Agent working but no Squad Chat messages.

**Check:**

1. Squad Chat endpoint: `POST http://localhost:3001/api/chat/squad`
2. Authorization header
3. Required fields: `agent`, `message`, `model`, `tags`

**Fix:** Test Squad Chat endpoint manually, verify agent is posting at each major step.

### Telemetry Missing

**Symptom:** No telemetry events recorded for agent runs.

**Check:**

1. `run.started` event sent at beginning
2. `run.completed` event sent at end
3. `run.tokens` event sent with token counts

**Fix:** Ensure agent emits all three telemetry events (see Execution Workflow).

---

## API Reference Summary

Quick reference for agents executing PRD-driven workflows:

| Endpoint                                        | Method | Purpose                         |
| ----------------------------------------------- | ------ | ------------------------------- |
| `/api/tasks/{id}`                               | GET    | Fetch task details and subtasks |
| `/api/tasks/{id}/subtasks/{subtaskId}/complete` | POST   | Mark subtask complete           |
| `/api/tasks/{id}/time/start`                    | POST   | Start time tracking             |
| `/api/tasks/{id}/time/stop`                     | POST   | Stop time tracking              |
| `/api/tasks/{id}/review`                        | POST   | Submit review scores            |
| `/api/tasks/{id}/comments`                      | POST   | Add closing comment             |
| `/api/tasks/{id}/complete`                      | POST   | Mark task complete              |
| `/api/tasks/{id}`                               | PATCH  | Update task (e.g., set blocked) |
| `/api/chat/squad`                               | POST   | Post to Squad Chat              |
| `/api/telemetry/events`                         | POST   | Emit telemetry events           |
| `/api/errors`                                   | POST   | Record error for learning       |

**Full API documentation:** See [FEATURES.md](../FEATURES.md#api) for complete API reference.

---

_Last updated: 2026-02-12 · [Back to Features](../FEATURES.md)_
