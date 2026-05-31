import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createDesktopPaths } from '../paths.js';
import {
  applyDesktopWindowState,
  readDesktopWindowState,
  writeDesktopWindowState,
  writeDesktopWindowStateSync,
} from '../window-state.js';

async function paths() {
  const root = await mkdtemp(path.join(tmpdir(), 'veritas-window-state-'));
  return createDesktopPaths({
    userDataPath: path.join(root, 'userData'),
    repoRoot: root,
    isPackaged: true,
  });
}

describe('desktop window state', () => {
  it('persists and restores sanitized window state', async () => {
    const desktopPaths = await paths();

    await writeDesktopWindowState(desktopPaths, {
      width: 1400.2,
      height: 920.7,
      x: 40.4,
      y: 50.5,
      maximized: true,
    });

    await expect(readDesktopWindowState(desktopPaths)).resolves.toEqual({
      width: 1400,
      height: 921,
      x: 40,
      y: 51,
      maximized: true,
    });
  });

  it('falls back to stable dimensions for invalid saved state', () => {
    expect(applyDesktopWindowState({ width: 10, height: Number.NaN })).toEqual({
      width: 720,
      height: 900,
      x: undefined,
      y: undefined,
    });
  });

  it('supports synchronous close-path persistence', async () => {
    const desktopPaths = await paths();

    writeDesktopWindowStateSync(desktopPaths, {
      width: 1200,
      height: 800,
      x: 10,
      y: 20,
    });

    await expect(readDesktopWindowState(desktopPaths)).resolves.toMatchObject({
      width: 1200,
      height: 800,
      x: 10,
      y: 20,
    });
  });
});
