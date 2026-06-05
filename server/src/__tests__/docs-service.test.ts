import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { DocsService } from '../services/docs-service.js';

describe('DocsService', () => {
  let tmpDir: string;
  let docsRoot: string;
  let siblingRoot: string;
  let service: DocsService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-service-'));
    docsRoot = path.join(tmpDir, 'docs');
    siblingRoot = path.join(tmpDir, 'docs2');
    await fs.mkdir(docsRoot, { recursive: true });
    await fs.mkdir(siblingRoot, { recursive: true });
    service = new DocsService(docsRoot);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps normal docs operations inside the configured root', async () => {
    const saved = await service.saveFile('guides/intro.md', '# Intro');

    expect(saved.path).toBe('guides/intro.md');
    expect(saved.content).toBe('# Intro');

    const files = await service.listFiles({ directory: 'guides' });
    expect(files.map((file) => file.path)).toEqual(['guides/intro.md']);

    const loaded = await service.getFile('guides/intro.md');
    expect(loaded?.content).toBe('# Intro');

    await expect(service.deleteFile('guides/intro.md')).resolves.toBe(true);
    await expect(service.getFile('guides/intro.md')).resolves.toBeNull();
  });

  it('rejects sibling-prefix traversal for read, write, list, and delete operations', async () => {
    const outsidePath = path.join(siblingRoot, 'secret.md');
    await fs.writeFile(outsidePath, 'outside', 'utf-8');

    const traversalFile = path.join('..', 'docs2', 'secret.md');
    const traversalDirectory = path.join('..', 'docs2');

    await expect(service.getFile(traversalFile)).resolves.toBeNull();
    await expect(service.listFiles({ directory: traversalDirectory })).resolves.toEqual([]);
    await expect(service.saveFile(traversalFile, 'owned')).rejects.toThrow('Invalid file path');
    await expect(service.deleteFile(traversalFile)).resolves.toBe(false);
    await expect(fs.readFile(outsidePath, 'utf-8')).resolves.toBe('outside');
  });

  it('rejects decoded encoded-separator traversal paths', async () => {
    const outsidePath = path.join(siblingRoot, 'encoded.md');
    await fs.writeFile(outsidePath, 'outside', 'utf-8');

    const traversalFile = decodeURIComponent('..%2Fdocs2%2Fencoded.md');

    await expect(service.getFile(traversalFile)).resolves.toBeNull();
    await expect(service.saveFile(traversalFile, 'owned')).rejects.toThrow('Invalid file path');
    await expect(fs.readFile(outsidePath, 'utf-8')).resolves.toBe('outside');
  });

  it('blocks docs-root symlink escapes', async () => {
    const outsideRoot = path.join(tmpDir, 'outside');
    const outsidePath = path.join(outsideRoot, 'secret.md');
    const linkPath = path.join(docsRoot, 'linked');
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.writeFile(outsidePath, 'outside', 'utf-8');

    try {
      await fs.symlink(outsideRoot, linkPath, 'dir');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOTSUP') return;
      throw err;
    }

    await expect(service.getFile('linked/secret.md')).resolves.toBeNull();
    await expect(service.listFiles({ directory: 'linked' })).resolves.toEqual([]);
    await expect(service.saveFile('linked/new.md', 'owned')).rejects.toThrow('Invalid file path');
    await expect(service.deleteFile('linked/secret.md')).resolves.toBe(false);
    await expect(fs.readFile(outsidePath, 'utf-8')).resolves.toBe('outside');
    await expect(fs.access(path.join(outsideRoot, 'new.md'))).rejects.toThrow();
  });
});
