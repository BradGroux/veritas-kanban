import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalWorkspaceFileRepository } from '../storage/workspace-file-repository.js';

describe('LocalWorkspaceFileRepository', () => {
  let workspaceRoot: string;
  const repository = new LocalWorkspaceFileRepository();

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'workspace-file-repository-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('reads optional workspace text and distinguishes missing files', async () => {
    await writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Repository instructions\n', 'utf8');

    await expect(repository.readOptionalText(workspaceRoot, 'AGENTS.md')).resolves.toBe(
      '# Repository instructions\n'
    );
    await expect(repository.readOptionalText(workspaceRoot, 'CLAUDE.md')).resolves.toBeNull();
  });

  it('rejects paths outside the workspace root', async () => {
    await expect(repository.readOptionalText(workspaceRoot, '../AGENTS.md')).rejects.toThrow(
      /outside the base directory/i
    );
  });

  it('rejects workspace symlinks that resolve outside the root', async () => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'workspace-file-outside-'));
    try {
      await writeFile(path.join(outsideRoot, 'AGENTS.md'), '# Outside instructions\n', 'utf8');
      await symlink(path.join(outsideRoot, 'AGENTS.md'), path.join(workspaceRoot, 'AGENTS.md'));

      await expect(repository.readOptionalText(workspaceRoot, 'AGENTS.md')).rejects.toThrow(
        /outside the base directory/i
      );
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
