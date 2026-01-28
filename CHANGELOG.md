# Changelog

All notable changes to Veritas Kanban.

## [0.10.0] - 2026-01-28 (Sprint 1500 - Status Refactor)

### Changed
- **Status Rename: review → blocked (US-1501-1504)**
  - Renamed `TaskStatus.review` to `TaskStatus.blocked` across entire codebase
  - Updated column header from "Review" to "Blocked" with red color scheme
  - Propagated changes through all frontend components and backend services
  - Updated keyboard shortcuts, dashboard metrics, and automation rules

### Added
- **Data Migration (US-1505)**
  - Automatic migration on server startup: converts any `review` tasks to `blocked`
  - Handles both active and archived tasks
  - Idempotent — safe to run multiple times
  - Migration count logged on startup

- **Migration Tests (US-1506)**
  - 8 new tests for migration service
  - Validates TaskStatus type (blocked valid, review invalid)
  - Tests for idempotency, empty lists, multiple tasks, archived tasks

- **Blocked Reason Tracking (US-1507)**
  - New `BlockedCategory` type: waiting-on-feedback | technical-snag | prerequisite | other
  - `blockedReason` field on Task interface with category + optional note
  - UI: category dropdown + notes textarea in task detail panel
  - Auto-prompt when task moves to Blocked status
  - Blocked reason badges on Kanban cards (icons + labels)
  - Auto-clear when task moves out of Blocked
  - Dashboard breakdown showing count by blocked category

- **Metrics Refactor (US-1403)**
  - Added 30-day period support to all metrics endpoints
  - Per-agent breakdown in run/token/duration metrics
  - Streaming NDJSON reader for efficient file processing
  - Performance: 24ms for 30-day queries (target was <500ms)

### Fixed
- Attachment service test regex now allows hyphens in generated IDs

## [0.9.0] - 2026-01-28 (Sprint 1150 - Settings Hardening)

### Added
- **Component Extraction (US-1151)**
  - Refactored monolithic 1000+ line SettingsDialog into 7 focused tab components
  - Extracted 5 reusable shared components (ToggleRow, NumberRow, SaveIndicator, etc.)
  - Lazy-loaded tabs with Suspense boundaries (80KB initial bundle reduction)
  
- **Error Boundaries (US-1152)**
  - SettingsErrorBoundary wraps each tab for crash isolation
  - User-friendly error fallbacks with "Try Again" recovery
  - Expandable error details for debugging
  
- **Security Hardening (US-1153)**
  - Strict Zod validation for all imports (templates, config)
  - XSS prevention (strip `<script>`, `javascript:`, `data:` URLs)
  - Path traversal blocking (`../`, absolute paths)
  - Prototype pollution protection (`__proto__`, `constructor` rejection)
  - Rate limiting on import endpoint (5 req / 15 min)
  
- **Test Coverage (US-1154)**
  - Unit tests for all shared components
  - Integration tests for tab interactions
  - Accessibility test suite (ARIA, keyboard nav)
  - Security test suite (XSS, traversal, pollution)
  
- **Performance Optimizations (US-1155)**
  - React.memo on all shared components with proper equality checks
  - Debounced settings updates (500ms delay)
  - Correct dependency arrays in all hooks
  - Code splitting per tab
  
- **Accessibility (US-1156)**
  - WCAG 2.1 AA compliance
  - Descriptive ARIA labels on all 32 interactive elements
  - ARIA live regions for save status announcements
  - Logical focus management and tab order
  - Keyboard shortcuts (Escape to close, arrows to navigate)
  
- **Toast System (US-1158)**
  - Replaced all `alert()` and `confirm()` with toast notifications
  - Support for infinity duration persistent toasts
  - Auto-dismiss with configurable timeouts
  - Non-blocking, consistent UI

### Fixed
- No circular dependencies in settings module
- Memory leaks from un-dismissed toasts (cleanup on unmount)
- Generic ARIA labels replaced with descriptive ones

## [0.8.0] - 2026-01-26

### Added
- **Clawdbot Agent Integration** — Replaced direct PTY spawning with `sessions_spawn` delegation
- Agent requests written to `.veritas-kanban/agent-requests/` for Veritas to pick up
- Completion callback endpoint `/api/agents/:id/complete`
- CLI commands: `vk agents:pending`, `vk agents:status`, `vk agents:complete`

### Fixed
- Sidebar X button overlapping with action icons (Archive, Activity, Preview, Conflicts)

## [0.7.0] - 2026-01-26 (Sprint 7)

### Added
- **Archive Management**
  - Archive sidebar with search and filters
  - Restore archived tasks to board
  - Auto-archive suggestions for completed projects
  
- **Task Organization**
  - Subtasks with progress tracking
  - Task dependencies with blocking
  - Multiple task attempts with history
  
- **Git Workflow**
  - GitHub PR creation from UI
  - Merge conflict resolution UI
  - Preview mode with embedded dev server
  
- **Time Tracking**
  - Start/stop timer on tasks
  - Manual time entry
  - Time summary per project
  
- **UI Polish**
  - Running indicator on task cards (animated glow)
  - Activity log sidebar

## [0.6.0] - 2026-01-26 (Sprint 6)

### Added
- Keyboard shortcuts (`?` for help, `c` create, `j/k` navigate, `1-4` status)
- Filter bar with search, project, and type filters
- Task templates (create from template)
- Bulk actions (multi-select, bulk status change, archive, delete)
- Activity logging

## [0.5.0] - 2026-01-26 (Sprint 5)

### Added
- **CLI** (`vk` command)
  - Task CRUD operations
  - Agent control commands
  - Summary and memory export
  - Notification management
  
- **MCP Server**
  - 15 tools for AI assistants
  - 3 resources (tasks, active, single task)
  - Stdio transport for Claude Desktop
  
- **Sub-agent Integration**
  - Task automation field
  - Agent completion tracking
  
- **Memory Sync**
  - Summary endpoints
  - Markdown export for daily notes
  
- **Teams Notifications**
  - Notification queue system
  - Multiple notification types

## [0.4.0] - 2026-01-26 (Sprint 4)

### Added
- Unified diff viewer with file tree
- Line-level comments on code changes
- Approval workflow (approve/request changes/reject)
- Merge and close functionality

## [0.3.0] - 2026-01-26 (Sprint 3)

### Added
- Agent panel with process management
- Agent output streaming via WebSocket
- Agent configuration (Claude Code, Amp, Copilot, Gemini)
- Task attempt tracking

## [0.2.0] - 2026-01-26 (Sprint 2)

### Added
- Git worktree management
- Branch creation per task
- Worktree status display
- Merge back to base branch
- Worktree cleanup

## [0.1.0] - 2026-01-26 (Sprint 1)

### Added
- Initial project setup (monorepo with pnpm workspaces)
- Express server with WebSocket support
- React frontend with Vite and shadcn/ui
- Kanban board with 4 columns
- Task CRUD operations
- Drag-and-drop between columns
- Task detail panel
- Markdown file storage with frontmatter
- Dark mode UI
