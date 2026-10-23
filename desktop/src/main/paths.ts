import path from 'node:path';
import { cp, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import type { DesktopPaths } from './types.js';

export interface CreateDesktopPathsOptions {
  userDataPath: string;
  repoRoot: string;
  isPackaged: boolean;
  profile?: string;
  workspace?: string;
}

function profileSegment(profile: string | undefined): string {
  return (profile || 'default').replace(/[^a-zA-Z0-9._-]/g, '-');
}

function workspaceSegment(workspace: string | undefined): string {
  return (workspace || 'local').replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function createDesktopPaths(options: CreateDesktopPathsOptions): DesktopPaths {
  const profile = profileSegment(options.profile);
  const workspace = workspaceSegment(options.workspace);
  const legacyAppHome = options.isPackaged
    ? options.userDataPath
    : path.join(options.repoRoot, '.veritas-desktop-dev', profile);
  const profileDir = options.isPackaged
    ? path.join(options.userDataPath, 'profiles', profile)
    : path.join(options.repoRoot, '.veritas-desktop-dev', 'profiles', profile);
  const workspaceDir = path.join(profileDir, 'workspaces', workspace);
  const appHome = workspaceDir;
  const configDir = path.join(appHome, 'config');

  return {
    profile,
    workspace,
    appHome,
    profileDir,
    workspaceDir,
    legacyAppHome: legacyAppHome === appHome ? null : legacyAppHome,
    configDir,
    dataDir: path.join(appHome, 'data'),
    logsDir: path.join(appHome, 'logs'),
    runtimeDir: path.join(appHome, 'runtime'),
    exportsDir: path.join(appHome, 'exports'),
    backupsDir: path.join(appHome, 'backups'),
    debugBundlesDir: path.join(appHome, 'debug-bundles'),
    secretsFile: path.join(configDir, 'desktop-secrets.json'),
    migrationManifest: path.join(configDir, 'desktop-path-migration.json'),
  };
}

const MIGRATED_ENTRIES = ['config', 'data', 'logs', 'exports', 'backups', 'debug-bundles'] as const;

export interface DesktopPathMigrationResult {
  migrated: boolean;
  from: string | null;
  to: string;
  copiedEntries: string[];
  skippedReason?: string;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function migrationRecoveryError(paths: DesktopPaths, cause?: unknown): Error {
  return new Error(
    `Desktop legacy migration is incomplete or its manifest cannot be verified. Startup stopped; both copies are preserved. ` +
      `Quit all desktop instances and back up the legacy home (${paths.legacyAppHome ?? 'none'}) and workspace (${paths.appHome}). ` +
      `Reconcile the copies explicitly before marking ${paths.migrationManifest} completed. ` +
      `See https://github.com/BradGroux/veritas-kanban/blob/main/docs/WEB-TO-MAC-DESKTOP-MIGRATION.md#interrupted-legacy-path-migration.`,
    { cause }
  );
}

async function migrationCompleted(paths: DesktopPaths): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(paths.migrationManifest, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw migrationRecoveryError(paths, error);
  }
  try {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    if (
      !manifest ||
      typeof manifest !== 'object' ||
      manifest.from !== paths.legacyAppHome ||
      manifest.to !== paths.appHome ||
      typeof manifest.migrated !== 'boolean' ||
      !Array.isArray(manifest.copiedEntries) ||
      !manifest.copiedEntries.every((entry) => MIGRATED_ENTRIES.includes(entry)) ||
      manifest.migrated !== manifest.copiedEntries.length > 0 ||
      (manifest.skippedReason !== undefined && typeof manifest.skippedReason !== 'string')
    ) {
      throw new Error('Migration manifest identity or result is invalid');
    }
    // The former unversioned result was written only after its copy loop completed.
    if (manifest.schemaVersion === undefined && manifest.state === undefined) return true;
    if (manifest.schemaVersion === 1 && manifest.state === 'completed') return true;
    throw new Error('Migration is incomplete or has an unsupported state');
  } catch (error) {
    throw migrationRecoveryError(paths, error);
  }
}

async function persistMigration(
  paths: DesktopPaths,
  state: 'in-progress' | 'completed',
  result: DesktopPathMigrationResult
): Promise<void> {
  // Exclusive creation owns the first migration; completion replaces that marker
  // atomically. A failed write intentionally retains the incomplete marker.
  const temporary = state === 'completed' ? `${paths.migrationManifest}.${randomUUID()}.tmp` : null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary ?? paths.migrationManifest, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ schemaVersion: 1, state, ...result }, null, 2), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (temporary) await rename(temporary, paths.migrationManifest);
  } finally {
    await handle?.close();
    if (temporary) await rm(temporary, { force: true });
  }
}

export async function ensureDesktopPathLayout(
  paths: DesktopPaths
): Promise<DesktopPathMigrationResult> {
  const completed = await migrationCompleted(paths);
  await Promise.all([
    mkdir(paths.profileDir, { recursive: true }),
    mkdir(paths.workspaceDir, { recursive: true }),
    mkdir(paths.configDir, { recursive: true }),
    mkdir(paths.dataDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true }),
    mkdir(paths.exportsDir, { recursive: true }),
    mkdir(paths.backupsDir, { recursive: true }),
    mkdir(paths.debugBundlesDir, { recursive: true }),
  ]);

  const result: DesktopPathMigrationResult = {
    migrated: false,
    from: paths.legacyAppHome,
    to: paths.appHome,
    copiedEntries: [],
  };
  if (completed) return { ...result, skippedReason: 'legacy migration already completed' };

  try {
    await persistMigration(paths, 'in-progress', result);
    if (!paths.legacyAppHome) {
      result.skippedReason = 'no legacy app home';
    } else if (!(await exists(paths.legacyAppHome))) {
      result.skippedReason = 'legacy app home does not exist';
    } else {
      for (const entry of MIGRATED_ENTRIES) {
        const source = path.join(paths.legacyAppHome, entry);
        if (await exists(source)) {
          await cp(source, path.join(paths.appHome, entry), { recursive: true, force: false });
          result.copiedEntries.push(entry);
        }
      }
      result.migrated = result.copiedEntries.length > 0;
      if (!result.migrated) result.skippedReason = 'workspace app home already initialized';
    }
    await persistMigration(paths, 'completed', result);
    return result;
  } catch (error) {
    throw migrationRecoveryError(paths, error);
  }
}

export function resolveRepoRoot(appPath: string, cwd = process.cwd()): string {
  if (process.env.VERITAS_REPO_ROOT) {
    return process.env.VERITAS_REPO_ROOT;
  }

  if (path.basename(cwd) === 'desktop') {
    return path.resolve(cwd, '..');
  }

  const segments = appPath.split(path.sep);
  const desktopIndex = segments.lastIndexOf('desktop');
  if (desktopIndex > 0) {
    return segments.slice(0, desktopIndex).join(path.sep) || path.sep;
  }

  return path.resolve(appPath, '..');
}
