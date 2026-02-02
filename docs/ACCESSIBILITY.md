# Accessibility — Veritas Kanban

This document describes the accessibility features, testing methodology, and known limitations of Veritas Kanban. The goal is WCAG 2.1 Level AA conformance.

## Overview

Veritas Kanban includes the following accessibility features:

- **Skip to content** link (`SkipToContent` component)
- **Live announcements** for dynamic content changes (`LiveAnnouncer`)
- **Keyboard navigation** for all board operations (shortcuts, drag-and-drop)
- **ARIA landmarks** on all major UI sections (header, navigation, board, columns, panels)
- **Screen reader support** for drag-and-drop with real-time announcements
- **Reduced motion** support via `prefers-reduced-motion` media query
- **Focus-visible** outlines on all interactive elements

## Keyboard Navigation

### Global Shortcuts

| Key       | Action                                                               |
| --------- | -------------------------------------------------------------------- |
| `j` / `↓` | Select next task                                                     |
| `k` / `↑` | Select previous task                                                 |
| `Enter`   | Open selected task                                                   |
| `1`–`4`   | Move selected task to column (To Do, Planning, In Progress, Blocked) |
| `5`       | Move selected task to Done                                           |
| `c`       | Open create task dialog                                              |
| `?`       | Show keyboard shortcuts dialog                                       |

### Drag and Drop (Board)

Tasks can be reordered and moved between columns using keyboard:

**Reorder within a column (drag-and-drop):**

1. Focus a task card using Tab
2. Press **Space** or **Enter** to pick up the task
3. Use **Arrow keys** to reorder within the column
4. Press **Space** or **Enter** to drop, or **Escape** to cancel

**Move between columns (keyboard shortcuts):**

- Press **1–5** to move the selected task to a column (Todo, Planning, In Progress, Blocked, Done)

Screen reader announcements are provided for each phase:

- **Pick up**: "Picked up task [title] from [column]"
- **Over**: "Task [title] is over [column]"
- **Drop**: "Task [title] dropped in [column]"
- **Cancel**: "Dragging cancelled. Task [title] returned to [column]"

## ARIA Structure

### Landmarks

| Region           | Element            | ARIA                                       |
| ---------------- | ------------------ | ------------------------------------------ |
| Header           | `<header>`         | `role="banner"`                            |
| Navigation       | `<nav>`            | `aria-label="Main navigation"`             |
| Board            | `<section>`        | `aria-label="Kanban board, N tasks"`       |
| Columns          | `<div>` per column | `role="region"`, `aria-labelledby`         |
| Task cards       | `<div>`            | `role="article"`, descriptive `aria-label` |
| Filter bar       | `<div>`            | `role="search"`                            |
| Activity sidebar | Sheet panel        | `aria-label="Activity log"`                |
| Archive sidebar  | Sheet panel        | `aria-label="Archive"`                     |
| Chat panel       | Sheet panel        | `aria-label="Board/Task chat panel"`       |

### Form Controls

All form inputs have associated labels via either:

- `<Label htmlFor="...">` with matching `id`
- `aria-label` on the control directly

Error messages use `role="alert"` for immediate screen reader announcement.

### Interactive Components

- Icon-only buttons have descriptive `aria-label` attributes
- Decorative icons use `aria-hidden="true"`
- Expandable sections use `aria-expanded`
- Clickable cards use `role="button"` with `tabIndex={0}` and keyboard event handlers

## Testing Methodology

### Programmatic Testing

- **Unit tests** (Vitest + Testing Library): Verify ARIA attributes are rendered correctly on key components
- **Accessibility test file**: `web/src/__tests__/accessibility.test.tsx`
- Tests cover: KanbanBoard landmarks, CommentsSection labels, SubtasksSection labels, FloatingChat button

### Manual Testing Required

The following should be verified with a screen reader (VoiceOver on macOS, NVDA on Windows):

1. **Board navigation flow**: Tab through header → filter bar → board → columns → task cards
2. **Drag-and-drop announcements**: Pick up a task with keyboard, verify announcements are spoken
3. **Task detail panel**: Open a task, verify all sections are announced with labels
4. **Create task dialog**: Verify all form fields are labeled and navigable
5. **Chat panel**: Verify message log is announced, input is labeled
6. **Error states**: Verify error alerts are announced immediately

### Expected VoiceOver Navigation Flow

1. **Page load**: "Skip to main content" link available
2. **Header**: "Banner" landmark with navigation and toolbar
3. **Filter bar**: "Search" landmark with labeled controls
4. **Board**: "Kanban board, N tasks" section
5. **Columns**: Each column announced as "region" with column name
6. **Task cards**: Each card announced as "article" with title, priority, and status
7. **Panels**: Side panels announced with descriptive labels

## Known Limitations

1. **Color contrast**: Some color combinations (especially `muted-foreground` in light mode and `destructive` in dark mode) are borderline for WCAG AA 4.5:1 ratio. These are noted for follow-up but not changed in this PR to avoid design scope creep.

2. **Chat message rendering**: The markdown renderer in ChatPanel does not add ARIA roles to rendered code blocks. Complex chat responses may not be fully structured for screen readers.

3. **Dashboard charts**: Recharts-based visualizations (TrendsCharts, AgentComparison) are not fully accessible. Chart data should ideally be available as data tables for screen reader users. This is a known limitation of the charting library.

4. **Drag overlay**: During keyboard drag operations, the visual drag overlay may not be meaningful to screen reader users. The announcements provide the necessary context.

5. **Hover-only UI**: Some controls (comment edit/delete buttons, subtask delete) are only visible on hover. They remain focusable via keyboard Tab but are visually hidden until hovered. A future improvement could show them on focus as well.
