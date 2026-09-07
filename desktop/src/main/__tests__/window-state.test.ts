import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createDesktopPaths } from '../paths.js';
import {
  applyDesktopWindowState,
  captureDesktopWindowState,
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

describe('visible display restoration', () => {
  const primary = { x: 0, y: 25, width: 1440, height: 875 };
  const left = { x: -1920, y: -200, width: 1920, height: 1080 };
  it('moves disconnected-monitor windows to the primary work area', () => {
    expect(
      applyDesktopWindowState({ x: 5000, y: 300, width: 1200, height: 800 }, undefined, [primary])
    ).toEqual({ x: 120, y: 63, width: 1200, height: 800 });
  });
  it('preserves valid negative monitor coordinates', () => {
    expect(
      applyDesktopWindowState({ x: -1800, y: -100, width: 1200, height: 800 }, undefined, [
        primary,
        left,
      ])
    ).toEqual({ x: -1800, y: -100, width: 1200, height: 800 });
  });
  it('clamps dimensions and titlebar to a smaller scaled work area', () => {
    expect(
      applyDesktopWindowState({ x: -300, y: -200, width: 4000, height: 4000 }, undefined, [
        { x: 0, y: 24, width: 1024, height: 700 },
      ])
    ).toEqual({ x: 0, y: 24, width: 1024, height: 700 });
  });
  it('recovers malformed coordinates on a single screen', () => {
    expect(
      applyDesktopWindowState(
        { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 0, height: Number.NaN },
        undefined,
        [primary]
      )
    ).toEqual({ x: 130, y: 25, width: 1180, height: 875 });
  });
  it('captures normal bounds independently of maximized bounds', () => {
    const window = {
      getNormalBounds: vi.fn(() => ({ x: 30, y: 40, width: 1200, height: 800 })),
      getBounds: vi.fn(() => primary),
      isMaximized: () => true,
    };
    expect(captureDesktopWindowState(window as never)).toEqual({
      x: 30,
      y: 40,
      width: 1200,
      height: 800,
      maximized: true,
    });
    expect(window.getBounds).not.toHaveBeenCalled();
  });
});
