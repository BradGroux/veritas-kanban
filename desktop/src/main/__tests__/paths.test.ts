import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { createDesktopPaths, resolveRepoRoot } from '../paths.js';

describe('desktop paths', () => {
  it('uses a profile-isolated dev home in the repo', () => {
    const paths = createDesktopPaths({
      userDataPath: '/Users/example/Library/Application Support/Veritas Kanban',
      repoRoot: '/repo/veritas-kanban',
      isPackaged: false,
      profile: 'fresh profile',
    });

    expect(paths.appHome).toBe(
      path.join('/repo/veritas-kanban', '.veritas-desktop-dev', 'fresh-profile')
    );
    expect(paths.dataDir).toBe(path.join(paths.appHome, 'data'));
    expect(paths.logsDir).toBe(path.join(paths.appHome, 'logs'));
    expect(paths.runtimeDir).toBe(path.join(paths.appHome, 'runtime'));
  });

  it('uses app userData in packaged mode', () => {
    const paths = createDesktopPaths({
      userDataPath: '/Users/example/Library/Application Support/Veritas Kanban',
      repoRoot: '/repo/veritas-kanban',
      isPackaged: true,
    });

    expect(paths.appHome).toBe('/Users/example/Library/Application Support/Veritas Kanban');
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
