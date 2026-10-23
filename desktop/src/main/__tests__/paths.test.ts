import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createDesktopPaths, ensureDesktopPathLayout, resolveRepoRoot } from '../paths.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('desktop paths', () => {
  it('uses profile and workspace isolated dev homes in the repo', () => {
    const paths = createDesktopPaths({
      userDataPath: '/Users/example/Library/Application Support/Veritas Kanban',
      repoRoot: '/repo/veritas-kanban',
      isPackaged: false,
      profile: 'fresh profile',
      workspace: 'demo workspace',
    });

    expect(paths.appHome).toBe(
      path.join(
        '/repo/veritas-kanban',
        '.veritas-desktop-dev',
        'profiles',
        'fresh-profile',
        'workspaces',
        'demo-workspace'
      )
    );
    expect(paths.profile).toBe('fresh-profile');
    expect(paths.workspace).toBe('demo-workspace');
    expect(paths.legacyAppHome).toBe(
      path.join('/repo/veritas-kanban', '.veritas-desktop-dev', 'fresh-profile')
    );
    expect(paths.dataDir).toBe(path.join(paths.appHome, 'data'));
    expect(paths.logsDir).toBe(path.join(paths.appHome, 'logs'));
    expect(paths.runtimeDir).toBe(path.join(paths.appHome, 'runtime'));
    expect(paths.secretsFile).toBe(path.join(paths.configDir, 'desktop-secrets.json'));
  });

  it('uses app userData with profile and workspace isolation in packaged mode', () => {
    const paths = createDesktopPaths({
      userDataPath: '/Users/example/Library/Application Support/Veritas Kanban',
      repoRoot: '/repo/veritas-kanban',
      isPackaged: true,
      profile: 'default',
      workspace: 'local',
    });

    expect(paths.appHome).toBe(
      path.join(
        '/Users/example/Library/Application Support/Veritas Kanban',
        'profiles',
        'default',
        'workspaces',
        'local'
      )
    );
    expect(paths.legacyAppHome).toBe('/Users/example/Library/Application Support/Veritas Kanban');
  });

  it('copies legacy desktop data into the workspace app home without deleting the source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'veritas-desktop-paths-'));
    roots.push(root);
    const legacyData = path.join(root, '.veritas-desktop-dev', 'fresh', 'data');
    const paths = createDesktopPaths({
      userDataPath: path.join(root, 'userData'),
      repoRoot: root,
      isPackaged: false,
      profile: 'fresh',
    });
    await mkdir(legacyData, { recursive: true });
    await writeFile(path.join(legacyData, 'veritas.db'), 'db');

    const result = await ensureDesktopPathLayout(paths);

    expect(result.migrated).toBe(true);
    expect(result.copiedEntries).toEqual(['data']);
    await expect(readFile(path.join(paths.dataDir, 'veritas.db'), 'utf-8')).resolves.toBe('db');
    await expect(readFile(path.join(legacyData, 'veritas.db'), 'utf-8')).resolves.toBe('db');
  });

  it('resolves repo root from package cwd', () => {
    expect(
      resolveRepoRoot('/repo/veritas-kanban/desktop/out/main', '/repo/veritas-kanban/desktop')
    ).toBe('/repo/veritas-kanban');
  });

  it('resolves repo root from electron-vite app output path', () => {
    expect(resolveRepoRoot('/repo/veritas-kanban/desktop/out/main', '/repo/veritas-kanban')).toBe(
      '/repo/veritas-kanban'
    );
  });
});
