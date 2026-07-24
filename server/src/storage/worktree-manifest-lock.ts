import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';

const log = createLogger('worktree-manifest-lock');
const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;
const inProcessQueues = new Map<string, Promise<void>>();

interface WorktreeManifestLockInfo {
  pid: number;
  createdAt: string;
  token: string;
}

async function enqueue(key: string, timeoutMs: number): Promise<() => void> {
  const previous = inProcessQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  inProcessQueues.set(key, current);

  const timedOut = Symbol('timeout');
  const result = await Promise.race([
    previous.then(() => 'ready' as const),
    new Promise<symbol>((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
  ]);
  if (result === timedOut) {
    previous.then(release, release);
    throw new Error('worktree manifest in-process lock queue timed out');
  }

  return () => {
    if (inProcessQueues.get(key) === current) inProcessQueues.delete(key);
    release();
  };
}

async function publishLock(lockFile: string): Promise<string | null> {
  const token = randomBytes(24).toString('hex');
  const candidateFile = `${lockFile}.${token}.candidate`;
  const metadata: WorktreeManifestLockInfo = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    token,
  };

  try {
    await fs.mkdir(path.dirname(lockFile), { recursive: true });
    await fs.writeFile(candidateFile, JSON.stringify(metadata), { flag: 'wx' });
    await fs.link(candidateFile, lockFile);
    return token;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  } finally {
    await fs.unlink(candidateFile).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn({ err: error, candidateFile }, 'Failed to remove worktree lock candidate');
      }
    });
  }
}

async function releaseLock(lockFile: string, expectedToken: string): Promise<void> {
  try {
    const content = await fs.readFile(lockFile, 'utf8');
    const current = JSON.parse(content) as Partial<WorktreeManifestLockInfo>;
    if (current.token !== expectedToken) {
      log.warn({ lockFile }, 'Worktree manifest lock ownership changed before release');
      return;
    }
    await fs.unlink(lockFile);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ err: error, lockFile }, 'Failed to release worktree manifest lock');
    }
  }
}

async function acquireLock(lockKey: string, timeoutMs: number): Promise<() => Promise<void>> {
  const key = path.resolve(lockKey);
  const lockFile = `${lockKey}.lock`;
  const deadline = Date.now() + timeoutMs;
  let releaseQueue: (() => void) | undefined;

  try {
    releaseQueue = await enqueue(key, timeoutMs);
  } catch {
    throw new Error(`Worktree manifest lock timed out after ${timeoutMs}ms`);
  }

  try {
    while (Date.now() < deadline) {
      const token = await publishLock(lockFile);
      if (token) {
        const queueRelease = releaseQueue;
        return async () => {
          await releaseLock(lockFile, token);
          queueRelease();
        };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (error) {
    releaseQueue();
    throw error;
  }

  releaseQueue();
  throw new Error(
    `Worktree manifest lock is held or stale at ${lockFile}; confirm that no Veritas ` +
      'process owns it before removing the lock file'
  );
}

export async function withWorktreeManifestLock<T>(
  lockKey: string,
  operation: () => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const release = await acquireLock(lockKey, timeoutMs);
  try {
    return await operation();
  } finally {
    await release();
  }
}
