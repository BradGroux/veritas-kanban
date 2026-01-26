# Sprint 7: Archive, Organization & Advanced Features

**Goal:** Complete the backlog - archive management, subtasks, dependencies, and quality-of-life features.

**Started:** 2026-01-26
**Status:** In Progress

---

## Stories

| ID | Title | Status | Dependencies | Notes |
|----|-------|--------|--------------|-------|
| US-701 | Archive sidebar | ⏳ Todo | None | Slide-out viewer with search/filter for archived tasks |
| US-702 | Restore from archive | ⏳ Todo | US-701 | Unarchive tasks back to board |
| US-703 | Subtasks | ⏳ Todo | None | Nested tasks with parent completion logic |
| US-704 | Task dependencies | ⏳ Todo | US-703 | Block tasks until dependencies complete |
| US-705 | Multiple task attempts | ⏳ Todo | None | Retry with different agent, preserve history |
| US-706 | Auto-archive suggestions | ⏳ Todo | US-701, US-703 | Suggest archiving when project complete |
| US-707 | GitHub PR creation | ⏳ Todo | None | Create PR from task detail UI |
| US-708 | Preview mode | ⏳ Todo | None | Embedded browser for dev server preview |
| US-709 | Merge conflict resolution | ⏳ Todo | None | Visual conflict resolver UI |
| US-710 | Time tracking | ⏳ Todo | None | Start/stop timer, manual entry, reports |

---

## Story Details

### US-701: Archive sidebar
- Slide-out panel (like Activity log)
- List all archived tasks
- Search by title/description
- Filter by project, type, date range
- Click to view task details

### US-702: Restore from archive
- "Restore" button in archive sidebar
- Returns task to Done column
- Preserves all task data

### US-703: Subtasks
- Add subtasks to any task
- Subtasks displayed nested under parent
- Checkbox completion
- Parent shows progress (3/5 complete)
- Parent auto-completes when all subtasks done (optional)

### US-704: Task dependencies
- "Blocked by" field in task detail
- Visual indicator for blocked tasks
- Cannot move blocked task to In Progress
- Auto-unblock when dependency completes

### US-705: Multiple task attempts
- "New Attempt" button on completed/failed tasks
- Select different agent for retry
- Previous attempts preserved in history
- View logs from any attempt

### US-706: Auto-archive suggestions
- Detect when all tasks in a project are Done
- Show notification/banner suggesting archive
- One-click archive all completed project tasks

### US-707: GitHub PR creation
- "Create PR" button on tasks with branches
- Pre-fill title/description from task
- Select target branch
- Opens PR in browser on success
- Shows PR link in task detail

### US-708: Preview mode
- Configure dev server command per repo
- Embedded iframe preview panel
- URL detection from dev server output
- Refresh button
- Open in external browser option

### US-709: Merge conflict resolution
- Detect conflicts on rebase/merge
- Show conflicting files with diff
- Side-by-side conflict viewer
- Accept theirs/ours/manual buttons
- Mark resolved and continue merge

### US-710: Time tracking
- Start/stop timer on tasks
- Manual time entry option
- Time displayed on task card
- Time summary per project
- Export time report

---

## Progress Log

### 2026-01-26

(Starting Sprint 7)
