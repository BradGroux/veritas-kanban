/**
 * Centralized filesystem primitives.
 *
 * ALL direct imports from the Node.js `fs` module live here (or in other
 * `storage/` files). Service and route code that needs low-level fs access
 * imports from this module instead of `'fs'` directly.
 *
 * NOTE: We use default imports from `node:fs` to avoid brittle named-import
 * interop when Vite/Vitest processes CJS builtins.
 */

import fs from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  access,
  mkdir as mkdirAsync,
  readFile as readFileAsync,
  readdir as readdirAsync,
  rename as renameAsync,
  rm as rmAsync,
  unlink as unlinkAsync,
  writeFile as writeFileAsync,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Synchronous helpers (used by security config, agent status persistence)
// ---------------------------------------------------------------------------

export const existsSync = fs.existsSync;
export const readFileSync = fs.readFileSync;
export const writeFileSync = fs.writeFileSync;
export const mkdirSync = fs.mkdirSync;
export const renameSync = fs.renameSync;

// ---------------------------------------------------------------------------
// Watcher primitives (used by task-service, config-service cache invalidation)
// ---------------------------------------------------------------------------

function createNoopWatcher(): FSWatcher {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    close: () => {
      emitter.removeAllListeners();
      return undefined;
    },
  }) as unknown as FSWatcher;
}

export function watch(...args: Parameters<typeof fs.watch>): FSWatcher {
  if (process.env.VERITAS_DISABLE_WATCHERS === '1') {
    return createNoopWatcher();
  }
  return fs.watch(...args);
}

export type { FSWatcher };

// ---------------------------------------------------------------------------
// Stream creators (used by telemetry compression / decompression)
// ---------------------------------------------------------------------------

export const createReadStream = fs.createReadStream;
export const createWriteStream = fs.createWriteStream;

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

export const mkdir = mkdirAsync;
export const readFile = readFileAsync;
export const readdir = readdirAsync;
export const rename = renameAsync;
export const rm = rmAsync;
export const unlink = unlinkAsync;
export const writeFile = writeFileAsync;

/**
 * Atomic file replacement.
 *
 * Writes `content` to a randomly-named sibling temp file on the same
 * filesystem as `destPath`, then renames it over `destPath`. On filesystems
 * where same-device replacement rename is atomic, readers either see the old
 * file or the new file — never a partial write. This does not claim crash
 * durability because the file and parent directory are not explicitly synced.
 * The temp file is cleaned up on failure so it does not accumulate.
 *
 * Encoding defaults to `'utf-8'` to match the old `writeFile` call sites.
 */
export async function atomicWriteFile(
  destPath: string,
  content: string | Buffer,
  encoding: BufferEncoding = 'utf-8'
): Promise<void> {
  const suffix = randomBytes(6).toString('hex');
  const tmpPath = `${destPath}.tmp.${suffix}`;

  try {
    await writeFileAsync(tmpPath, content, encoding);
    await renameAsync(tmpPath, destPath);
  } catch (err) {
    // Best-effort cleanup; ignore errors — the original file is untouched.
    await unlinkAsync(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Async file-existence check.
 *
 * Drop-in replacement for `existsSync` in async code paths.
 * Returns `true` when the path is accessible, `false` otherwise.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bounded-concurrency batch helper
// ---------------------------------------------------------------------------

/**
 * Maximum number of concurrent file-read operations.
 *
 * Tuned for a single-process Node.js server: high enough to saturate the OS
 * page cache on fast NVMe storage, low enough to avoid fd exhaustion or
 * excessive memory pressure when the task directory is large.
 */
export const BATCH_CONCURRENCY = 10;

/**
 * Run an array of async tasks with bounded concurrency.
 *
 * Works like `Promise.all(items.map(fn))` but limits the number of
 * concurrently-running promises to `concurrency`.  Individual item errors
 * are **not** propagated — failed items resolve to `null` so that one bad
 * file never aborts the entire list operation.
 *
 * @param items       - Array of inputs to process
 * @param fn          - Async function receiving each item (must not throw)
 * @param concurrency - Max simultaneous tasks (default: BATCH_CONCURRENCY)
 * @returns Array of results, with `null` in place of any failed items
 */
export async function batchedMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = BATCH_CONCURRENCY
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await fn(items[index]);
      } catch {
        // Individual failures become null — callers filter these out
        results[index] = null;
      }
    }
  }

  // Spin up `concurrency` workers (or fewer if items.length is small)
  const workerCount = Math.min(concurrency, items.length);
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  return results;
}
// ci trigger
