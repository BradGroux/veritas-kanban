# Veritas Kanban — Full Feature Test Missions

**Date**: 2026-03-27
**Author**: claude-code
**Purpose**: Exercise ALL Veritas Kanban features through 10 realistic business scenarios with cross-agent AI evaluation

## Actors

| Actor           | Type     | Role in Tests                            |
| --------------- | -------- | ---------------------------------------- |
| **Francois**    | Human    | Orchestrator, reviewer, sole human actor |
| **claude-code** | AI Agent | Lead executor, evaluator                 |
| **codex**       | AI Agent | Code tasks, PRD review evaluator         |
| **gemini**      | AI Agent | Research, content review evaluator       |
| **jules**       | AI Agent | Tests, docs, compliance tasks            |
| **minimax**     | AI Agent | Fast review, security eval               |
| **manus**       | AI Agent | Research, content creation               |
| **genspark**    | AI Agent | Deep research, social intel              |

## Feature Coverage Matrix

Each mission exercises specific features. "Eval" column shows which agent evaluates.

| #   | Mission                    | Key Features                                                                              | Eval Agent |
| --- | -------------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| 1   | Q2 Sprint Planning         | Sprint, project, backlog, assignment, summary, agent registry                             | gemini     |
| 2   | Brodmann Atlas PRD         | Subtasks, acceptance criteria, verification, observations, deliverables, prompt templates | codex      |
| 3   | MDR Compliance Audit       | Workflow YAML, policies, decisions, audit log, transition hooks                           | gemini     |
| 4   | Multi-Agent Code Sprint    | Agent routing, delegation, time tracking, scoring, feedback, cost prediction              | minimax    |
| 5   | EA Berlin 2026 Travel      | Dependencies, cost prediction, time entries, notifications, comments, attachments         | genspark   |
| 6   | Equipment Maintenance      | Lifecycle hooks, transition hooks, lessons, error learning, shared resources              | jules      |
| 7   | Research Paper Pipeline    | Workflow YAML, feedback, drift detection, baselines, broadcasts                           | codex      |
| 8   | Marketing Content Pipeline | Chat, broadcasts, analytics, metrics, prompt templates, agent comparison                  | minimax    |
| 9   | Security & Governance      | Tool policies, permissions, policy eval, error learning, system health                    | gemini     |
| 10  | Board Hygiene              | Archive/restore, GitHub sync, reports, doc-freshness, health, change polling              | codex      |

## Mission Details

### Mission 1: Q2 Sprint Planning

- Create sprint "Q2-2026"
- Create project "NeuroClaw Infrastructure"
- Create 3 real tasks, assign to agents
- Move 2 existing backlog items into sprint
- Generate sprint summary
- **Eval**: gemini scores sprint plan quality (completeness, priority balance, agent distribution)

### Mission 2: Brodmann Atlas PRD (real project)

- Create PRD task for Phase 2: expand from 5 to 15 Brodmann areas + 3D model spike
- 6 subtasks with acceptance criteria (data schema, SVG expansion, 3D spike, i18n, news pipeline, deployment)
- Verification checklist (clinical accuracy, citation completeness, mobile responsive)
- Log design decisions as observations
- Register deliverables (PRD doc, architecture diagram, data schema)
- Create prompt template for spec generation
- **Eval**: codex scores PRD against product management quality criteria

### Mission 3: MDR Compliance Audit

- Create YAML workflow: gap-analysis → classification → conformity-assessment → technical-file → declaration
- Create policy: "require-approval" for compliance sign-off steps
- Log 2 regulatory decisions with assumptions and confidence scores
- Enable transition hook: require-verification-complete
- **Eval**: gemini scores regulatory completeness

### Mission 4: Multi-Agent Code Sprint

- Create coding task (upstream sync implementation)
- Test agent routing (which agent best fits?)
- Delegate to 2 agents
- Start/stop time tracking
- Create scoring profile (code quality: tests, lint, coverage, correctness)
- Score outputs, leave feedback ratings
- Get cost prediction
- **Eval**: minimax scores process efficiency

### Mission 5: EA Berlin 2026 — Budget Travel

- Create master task with 5 dependent subtasks:
  1. Check membership / register (free if member)
  2. Book flights LUX→BER (budget airlines)
  3. Book accommodation (hostel/Airbnb near Kreuzberg)
  4. Plan local transport (BER→betahaus)
  5. Budget summary (target: under EUR 400 total)
- Set dependencies (register before book)
- Add cost estimates as comments
- Create notification for May 1 booking deadline
- **Eval**: genspark scores budget optimization + completeness

### Mission 6: Equipment Maintenance Schedule

- Create task: Q2 EEG calibration cycle (Mitsar, BrainMaster, g.tec)
- Create lifecycle hook: notify on task.started
- Enable transition hooks: require-closing-comment, require-verification
- Add shared resources (equipment inventory)
- Log lessons learned from last calibration
- Log error learning entry
- **Eval**: jules scores operational readiness

### Mission 7: Research Paper Pipeline

- Create YAML workflow: draft → peer-review → revision → submission
- Create task tracking Kayhan's paper
- Submit feedback ratings at each stage
- Set drift baseline for review cycle duration (target: 14 days)
- Trigger drift alert test
- Send broadcast to research team
- **Eval**: codex scores academic workflow quality

### Mission 8: Marketing Content Pipeline

- Create task: Vielight PBM content (blog + social + landing page)
- Assign to manus (content), gemini (review), genspark (research)
- Create prompt template for PBM content guidelines
- Send chat messages coordinating agents
- Broadcast content brief
- Check analytics (timeline, throughput)
- Get agent comparison metrics
- **Eval**: minimax scores content pipeline efficiency

### Mission 9: Security & Governance Stress Test

- Create tool policies: deny docker.rm, deny git.push-force, require-approval for deploy.production
- Set agent permissions: minimax=intern, codex=specialist, claude-code=lead
- Evaluate 3 policy scenarios (allowed, denied, needs-approval)
- Log error learning from denied attempts
- Run system health check
- **Eval**: gemini scores governance coverage

### Mission 10: Board Hygiene & Full Integration

- Archive 3 old completed tasks
- Restore 1 archived task
- Trigger GitHub sync
- Check doc-freshness
- Test changes endpoint (ETag polling)
- Generate system health report
- Create/update prompt template
- List notifications
- **Eval**: codex scores operational hygiene

## Success Criteria

1. Every API endpoint category exercised at least once
2. Every CLI command used at least once
3. All 7 AI agents appear as actors
4. Cross-agent evaluation on every mission
5. Real, useful artifacts produced (sprint plan, PRD, travel plan, compliance workflow)
6. Scoring profiles produce quantitative scores
7. All results exportable to Word document
