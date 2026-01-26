# Sprint 6: Polish & Quality of Life

**Goal:** Keyboard shortcuts, filtering, and UI polish.

**Started:** 2026-01-26
**Status:** In Progress

---

## Stories

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| US-601 | Keyboard shortcuts | ✅ Complete | c, j/k, Enter, Esc, 1-4, ? |
| US-602 | Filter and search | ⏳ Todo | Project/type dropdowns, text search |
| US-603 | Task templates | ⏳ Todo | New from Template option |
| US-604 | Bulk actions | ⏳ Todo | Multi-select, bulk status/archive/delete |
| US-605 | Activity log | ⏳ Todo | Toggleable sidebar |

---

## Progress Log

### 2026-01-26

**US-601: Keyboard shortcuts** ✅
- Created `useKeyboard` context provider
- Implemented shortcuts:
  - `c` - Create new task
  - `j/k` or `↓/↑` - Navigate tasks
  - `Enter` - Open selected task
  - `Escape` - Close panel/clear selection
  - `1-4` - Move task to column (Todo/In Progress/Review/Done)
  - `?` - Toggle keyboard shortcuts help dialog
- Added keyboard icon to header
- Created `KeyboardShortcutsDialog` help modal
- Task selection highlighting with ring indicator
