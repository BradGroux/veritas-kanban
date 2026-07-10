/**
 * Tests for atomicWriteFile (#776)
 *
 * Verifies that:
 * - A successful write is visible atomically (no partial state).
 * - No temp files leak after a successful write.
 * - A failed rename does not silently corrupt (no stray .tmp.* files remain).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'path';
import os from 'os';
import { atomicWriteFile } from '../storage/fs-helpers.js';

describe('atomicWriteFile', () => {
  let testDir: string;

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('writes content atomically — final content matches what was written', async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `vk-atomic-test-${suffix}`);
    await fs.mkdir(testDir, { recursive: true });

    const destPath = path.join(testDir, 'task.md');
    const original = '# original content';
    const updated = '# updated content';

    await atomicWriteFile(destPath, original);
    expect(await fs.readFile(destPath, 'utf-8')).toBe(original);

    await atomicWriteFile(destPath, updated);
    expect(await fs.readFile(destPath, 'utf-8')).toBe(updated);
  });

  it('leaves no stray temp files after a successful write', async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `vk-atomic-noleak-${suffix}`);
    await fs.mkdir(testDir, { recursive: true });

    const destPath = path.join(testDir, 'task.md');
    await atomicWriteFile(destPath, '# content');

    const files = await fs.readdir(testDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('preserves an existing destination and cleans up when replacement rename fails', async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `vk-atomic-fail-${suffix}`);
    await fs.mkdir(testDir, { recursive: true });

    // Point dest at an existing non-empty directory — rename will fail with EISDIR/ENOTDIR
    const blockingDir = path.join(testDir, 'blocker');
    const blockingFile = path.join(blockingDir, 'sentinel');
    await fs.mkdir(blockingDir, { recursive: true });
    await fs.writeFile(blockingFile, 'sentinel');

    // Attempt to atomically write to the blocking directory path
    await expect(atomicWriteFile(blockingDir, '# would overwrite dir')).rejects.toThrow();

    // No stray .tmp.* files should remain in the parent dir
    const files = await fs.readdir(testDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);

    // The blocking directory must still be intact — nothing was destroyed
    await expect(fs.readFile(blockingFile, 'utf-8')).resolves.toBe('sentinel');
  });
});
