import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';

const log = createLogger('credential-broker-state-lock');
const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;
const inProcessQueues = new Map<string, Promise<void>>();

interface CredentialBrokerLockInfo {
  pid: number;
  createdAt: string;
  token: string;
}

async function enqueue(key: string, timeout: number): Promise<() => void> {
  const previous = inProcessQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  inProcessQueues.set(key, current);

  const timedOut = Symbol('timeout');
  const result = await Promise.race([
    previous.then(() => 'ready' as const),
    new Promise<symbol>((resolve) => setTimeout(() => resolve(timedOut), timeout)),
  ]);
  if (result === timedOut) {
    previous.then(release, release);
    throw new Error('credential broker in-process lock queue timed out');
  }

  return () => {
    if (inProcessQueues.get(key) === current) inProcessQueues.delete(key);
    release();
  };
}

async function publishLock(lockFile: string): Promise<string | null> {
  const token = randomBytes(24).toString('hex');
  const candidateFile = `${lockFile}.${token}.candidate`;
  const metadata: CredentialBrokerLockInfo = {
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
        log.warn({ err: error, candidateFile }, 'Failed to remove broker lock candidate');
      }
    });
  }
}

async function releaseLock(lockFile: string, expectedToken: string): Promise<void> {
  try {
    const content = await fs.readFile(lockFile, 'utf8');
    const current = JSON.parse(content) as Partial<CredentialBrokerLockInfo>;
    if (current.token !== expectedToken) {
      log.warn({ lockFile }, 'Credential broker lock ownership changed before release');
      return;
    }
    await fs.unlink(lockFile);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ err: error, lockFile }, 'Failed to release credential broker state lock');
    }
  }
}

async function acquireCredentialBrokerStateLock(
  statePath: string,
  timeout: number
): Promise<() => Promise<void>> {
  const key = path.resolve(statePath);
  const lockFile = `${statePath}.lock`;
  const deadline = Date.now() + timeout;
  let releaseQueue: (() => void) | undefined;
  try {
    releaseQueue = await enqueue(key, timeout);
  } catch {
    throw new Error(`Credential broker state lock timed out after ${timeout}ms`);
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
    `Credential broker state lock is held or stale at ${lockFile}; after confirming no ` +
      'Veritas process owns it, remove the lock file and retry'
  );
}

export async function withCredentialBrokerStateLock<T>(
  statePath: string,
  operation: () => Promise<T>,
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const release = await acquireCredentialBrokerStateLock(statePath, timeout);
  try {
    return await operation();
  } finally {
    await release();
  }
}
