import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Walk upward from a starting directory looking for a marker file.
 * Returns the directory containing the marker, or null.
 */
function findUp(startDir: string, markerFile: string, maxDepth = 8): string | null {
  let dir = path.resolve(startDir);

  for (let i = 0; i < maxDepth; i++) {
    if (existsSync(path.join(dir, markerFile))) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Resolve the monorepo root.
 *
 * - In dev, the server often runs with cwd=server/, so the root is one level up.
 * - In Docker, cwd is typically /app, but some environments can start with cwd=/.
 *
 * We DO NOT trust cwd alone — in containers it can be surprising. Instead we
 * walk upward looking for pnpm-workspace.yaml starting from both cwd and the
 * directory containing this module, and fall back to cwd only as a last resort.
 */
export function getProjectRoot(): string {
  // 1) CWD-based search (dev + most runtimes)
  const fromCwd = findUp(process.cwd(), 'pnpm-workspace.yaml');
  if (fromCwd) return fromCwd;

  // 2) Module-based search (robust in Docker / odd cwd situations)
  // Works in ESM: resolve the directory containing this module.
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const fromModule = findUp(moduleDir, 'pnpm-workspace.yaml');
    if (fromModule) return fromModule;
  } catch {
    // ignore — fallback below
  }

  // 3) Last resort — use cwd as-is (primarily for tests / unusual setups)
  return process.cwd();
}

/**
 * Storage root for ALL persistent data (tasks + runtime state).
 *
 * Resolution priority:
 *   1) DATA_DIR or VERITAS_DATA_DIR (Docker / explicit override)
 *   2) Discovered project root (via getProjectRoot)
 *
 * When DATA_DIR/VERITAS_DATA_DIR is set we treat it as the canonical base
 * directory so everything (tasks, .veritas-kanban, telemetry, etc.) lives on
 * the same volume.
 */
export function getStorageRoot(): string {
  const env = process.env.DATA_DIR || process.env.VERITAS_DATA_DIR;
  if (env && env.trim().length > 0) {
    return path.resolve(env);
  }

  const root = getProjectRoot();

  // Guardrail: avoid silently using filesystem root as a storage base.
  // This is the failure mode behind issue #62 (mkdir '/tasks' → EACCES).
  if (root === '/') {
    throw new Error(
      'Storage root resolved to "/". Set DATA_DIR (recommended for Docker) or run from the repo root.'
    );
  }

  return root;
}

/**
 * Runtime config/state directory.
 *
 * Local dev:
 *   <projectRoot>/.veritas-kanban
 *
 * Docker / DATA_DIR overrides:
 *   <DATA_DIR>/.veritas-kanban
 *
 * This is the single source of truth for the ".veritas-kanban" directory
 * used across the codebase.
 */
export function getRuntimeDir(): string {
  return path.join(getStorageRoot(), '.veritas-kanban');
}

/**
 * Historical name used throughout the codebase. Aliased here for clarity
 * in services that conceptually think in terms of a "data dir".
 */
export function getDataDir(): string {
  return getRuntimeDir();
}

// ---------------------------------------------------------------------------
// Task directories
// ---------------------------------------------------------------------------

/** Absolute path to the active tasks directory (tasks/active). */
export function getTasksActiveDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'active');
}

/** Absolute path to the archived tasks directory (tasks/archive). */
export function getTasksArchiveDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'archive');
}

/** Absolute path to the backlog tasks directory (tasks/backlog). */
export function getTasksBacklogDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'backlog');
}

/** Absolute path to the task attachments directory (tasks/attachments). */
export function getTasksAttachmentsDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'attachments');
}

// ---------------------------------------------------------------------------
// Telemetry / traces / logs / worktrees / templates
// ---------------------------------------------------------------------------

/** Directory for telemetry JSON files. */
export function getTelemetryDir(): string {
  return path.join(getRuntimeDir(), 'telemetry');
}

/** Directory for trace files. */
export function getTracesDir(): string {
  return path.join(getRuntimeDir(), 'traces');
}

/** Directory for log files. */
export function getLogsDir(): string {
  return path.join(getRuntimeDir(), 'logs');
}

/** Directory where git worktrees are created. */
export function getWorktreesDir(): string {
  return path.join(getRuntimeDir(), 'worktrees');
}

/** Directory for user templates. */
export function getTemplatesDir(): string {
  return path.join(getRuntimeDir(), 'templates');
}

/** Directory for chat transcripts (.veritas-kanban/chats). */
export function getChatsDir(): string {
  return path.join(getRuntimeDir(), 'chats');
}

/** Directory for audit logs (.veritas-kanban/audit). */
export function getAuditDir(): string {
  return path.join(getRuntimeDir(), 'audit');
}

/** Directory for broadcast markdown files (.veritas-kanban/broadcasts). */
export function getBroadcastsDir(): string {
  return path.join(getRuntimeDir(), 'broadcasts');
}

/** Directory for reports configuration and generated reports metadata. */
export function getReportsConfigDir(): string {
  return getRuntimeDir();
}

/** Directory where PDF/HTML report assets live (typically ../docs/reports). */
export function getReportsOutputDir(): string {
  // Keep historical layout: sibling docs/reports directory to .veritas-kanban
  return path.join(getStorageRoot(), 'docs', 'reports');
}

// ---------------------------------------------------------------------------
// Workflow Engine Directories (Phase 1 - v3.0)
// ---------------------------------------------------------------------------

/** Directory for workflow YAML definitions (.veritas-kanban/workflows). */
export function getWorkflowsDir(): string {
  return path.join(getRuntimeDir(), 'workflows');
}

/** Directory for workflow run state (.veritas-kanban/workflow-runs). */
export function getWorkflowRunsDir(): string {
  return path.join(getRuntimeDir(), 'workflow-runs');
}
