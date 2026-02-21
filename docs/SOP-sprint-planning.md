# SOP: Sprint Planning with AI Agents

Turn vague goals into a structured sprint the way we do internally: epics → sprint → tasks → subtasks. Agents can run most of this, but only if we give them a repeatable script.

---

## Hierarchy Refresher

| Level                 | Description                                  | Example                        |
| --------------------- | -------------------------------------------- | ------------------------------ |
| **Epic / Initiative** | Multi-sprint outcome, named scope-of-record. | "MessageMeld Launch"           |
| **Sprint**            | Time-boxed slice (`US-1600`, `BM-01`).       | "US-1600 — SOP Sprint"         |
| **Task**              | Single deliverable tracked on the board.     | "US-1601: 5-Minute Quickstart" |
| **Subtask**           | Checklist item inside a task.                | "Add screenshots"              |

Use `project` to represent product buckets (veritas-kanban, brainmeld, digital-meld) and `sprint` for the current iteration name.

---

## Prompt Template (Sprint Planner Agent)

```
Goal: <describe epic>
Project: <project name>
Sprint name: US-XXXX — <tagline>
Timebox: <dates or length>

1. Break the goal into 4-8 tasks (type, priority, acceptance criteria).
2. For each task add 3-8 subtasks that can be completed in under a day.
3. Tag each task with the sprint and project.
4. Assign task types (code, feature, research, docs, etc.).
5. Output JSON payload ready for POST /api/tasks (array of tasks).
6. After creation, post a summary comment to the sprint lead.
```

Store the final prompt under `prompt-registry/sprint-planning.md`.

---

## API Creation Flow

Use the bulk endpoint to create the entire sprint quickly:

```bash
curl -X POST http://localhost:3002/api/tasks/bulk \
  -H "Authorization: Bearer <admin-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "title": "US-1601: 5-Minute Quickstart",
        "description": "Guide that takes users from zero ➝ agent-ready in 5 min",
        "project": "veritas-kanban",
        "sprint": "US-1600",
        "type": "docs",
        "priority": "high",
        "subtasks": [
          {"title": "Prereqs section"},
          {"title": "Install steps"},
          {"title": "Agent hookup"}
        ]
      }
    ]
  }'
```

CLI alternative:

```bash
vk create "US-1601: 5-Minute Quickstart" \
  --project veritas-kanban \
  --sprint US-1600 \
  --type docs \
  --priority high
```

Add subtasks via UI or `vk update --subtask "Add screenshots"` (coming soon).

---

## Estimation Pattern

We track estimates implicitly via subtasks: each subtask ≈ half-day of effort. Keep tasks between **1–3 days** of work. If it needs more, split it before the sprint starts.

1. Count subtasks (N).
2. Multiply by 0.5 days to get a gut-check estimate.
3. Compare against sprint capacity (agents × days × focus factor).

Example: 6 tasks × 4 subtasks × 0.5d = 12 agent-days. With 3 agents @ 4 days focus → 12 days capacity → sprint is feasible.

---

## Assignment Workflow

1. Tag each task with `owner` only if it is truly pre-assigned. Otherwise leave unassigned so agents can pull.
2. Use **Projects** to separate product lines; use board filters when assigning.
3. Start timers at task pickup (`vk begin`).
4. Use the Agent Status sidebar to confirm at most 1 active task per agent.

---

## Example Sprint (excerpt)

| Task                               | Type | Priority | Notes                     |
| ---------------------------------- | ---- | -------- | ------------------------- |
| US-1601: 5-Min Quickstart          | docs | high     | This guide.               |
| US-1602: Task Workflow SOP         | docs | high     | Defines lifecycle.        |
| US-1603: Sprint Planning SOP       | docs | medium   | This document.            |
| US-1604: Multi-Agent Orchestration | docs | medium   | PM + workers.             |
| US-1605: Cross-Model Review        | docs | medium   | Opposite model gate.      |
| US-1606: Best Practices            | docs | medium   | Patterns + anti-patterns. |

Clone this pattern for your own projects; rename sprint `US-YYYY` and fill tasks accordingly.

### Example: Bug Fix Sprint (RF-002 cleanup)

| Task                               | Type   | Priority | Notes                                     |
| ---------------------------------- | ------ | -------- | ----------------------------------------- |
| RF-002-A: Harden archive API       | bugfix | high     | Add withFileLock + validation.            |
| RF-002-B: Fix sidebar counts       | bugfix | medium   | Sync TaskRepository + StatusHistory.      |
| RF-002-C: Add regression tests     | qa     | medium   | Playwright coverage for archive + counts. |
| RF-002-D: Update docs + postmortem | docs   | medium   | Summarize lessons in AGENTS.md + README.  |

This mirrors how we handled the RF-002 audit sprint: tight scope, cross-functional subtasks, and clear notes for each fix.

---

## After Planning

- Drop sprint recap in `docs/` or `memory/` so the team has context.
- Create GitHub Milestone matching the sprint name (keeps issues + tasks aligned).
- Schedule daily standup summary: `vk summary standup --date today`.

Planning done right means agents always know what to pick up next.
