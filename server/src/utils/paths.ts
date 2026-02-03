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
 * - In dev, server often runs with cwd=server/, so root is one level up.
 * - In Docker, cwd is typically /app, but some environments can start with cwd=/.
 *
 * IMPORTANT: We do not trust cwd alone — in containers it can be surprising.
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

  // 3) Last resort
  return process.cwd();
}

/**
 * Storage root for persistent data.
 *
 * When DATA_DIR or VERITAS_DATA_DIR is set (e.g. Docker), we treat that as the base
 * directory for ALL persisted data.
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
 * Local-first layout keeps runtime files under <projectRoot>/.veritas-kanban.
 * In Docker, we keep them under <DATA_DIR>/.veritas-kanban so they live on the volume.
 */
export function getRuntimeDir(): string {
  return path.join(getStorageRoot(), '.veritas-kanban');
}

// Tasks
export function getTasksActiveDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'active');
}

export function getTasksArchiveDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'archive');
}

export function getTasksBacklogDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'backlog');
}

export function getTasksAttachmentsDir(): string {
  return path.join(getStorageRoot(), 'tasks', 'attachments');
}

// Telemetry / traces
export function getTelemetryDir(): string {
  return path.join(getRuntimeDir(), 'telemetry');
}

export function getTracesDir(): string {
  return path.join(getRuntimeDir(), 'traces');
}

export function getLogsDir(): string {
  return path.join(getRuntimeDir(), 'logs');
}

export function getWorktreesDir(): string {
  return path.join(getRuntimeDir(), 'worktrees');
}

export function getTemplatesDir(): string {
  return path.join(getRuntimeDir(), 'templates');
}
