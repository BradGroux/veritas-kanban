import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';
import { createLogger } from '../lib/logger.js';
import { getLegacyRuntimeDirs, getRuntimeDir } from './paths.js';

const log = createLogger('legacy-runtime-migration');

const STORAGE_ROOT_ONLY_DIRECTORIES = new Set(['tasks', 'docs']);

async function copyMissingTree(
  source: string,
  destination: string,
  runtimeRoot: string,
  topLevel = false
): Promise<number> {
  try {
    const sourceStats = await fs.lstat(source);
    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) return 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  const entries: Dirent<string>[] = await fs.readdir(source, {
    withFileTypes: true,
    encoding: 'utf-8',
  });

  await fs.mkdir(destination, { recursive: true });
  let copied = 0;

  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);

    // A legacy candidate can be the new storage root. Never recurse into the
    // canonical destination or copy storage-root-only trees into runtime state.
    if (path.resolve(from) === runtimeRoot) continue;
    if (topLevel && STORAGE_ROOT_ONLY_DIRECTORIES.has(entry.name)) continue;

    if (entry.isDirectory()) {
      copied += await copyMissingTree(from, to, runtimeRoot);
      continue;
    }

    // Runtime state is files and directories. Never follow legacy symlinks.
    if (!entry.isFile()) continue;

    try {
      await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      copied += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  return copied;
}

/**
 * Copy legacy runtime state into the canonical runtime directory.
 * Existing canonical files win and legacy sources are retained for rollback.
 */
export async function migrateLegacyRuntimeState(
  sources: readonly string[] = getLegacyRuntimeDirs(),
  destination = getRuntimeDir()
): Promise<number> {
  const runtimeRoot = path.resolve(destination);
  let copied = 0;

  for (const source of sources) {
    try {
      copied += await copyMissingTree(source, destination, runtimeRoot, true);
    } catch (error) {
      log.warn({ error, source, destination }, 'Failed to migrate legacy runtime directory');
    }
  }

  if (copied > 0) {
    log.info({ copied, destination }, 'Migrated legacy runtime state');
  }
  return copied;
}
