import { mkdirSync, writeFileSync } from 'node:fs';
import type { BrowserWindow, Rectangle } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DesktopPaths } from './types.js';
import { DESKTOP_MIN_WINDOW } from './app-metadata.js';

export interface DesktopWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

export const DEFAULT_DESKTOP_WINDOW_STATE: DesktopWindowState = {
  width: 1360,
  height: 900,
};

function statePath(paths: DesktopPaths): string {
  return path.join(paths.configDir, 'window-state.json');
}

export async function readDesktopWindowState(paths: DesktopPaths): Promise<DesktopWindowState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(paths), 'utf-8')) as DesktopWindowState;
    return sanitizeWindowState(parsed);
  } catch {
    return DEFAULT_DESKTOP_WINDOW_STATE;
  }
}

export async function writeDesktopWindowState(
  paths: DesktopPaths,
  state: DesktopWindowState
): Promise<void> {
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(statePath(paths), serializeWindowState(state), 'utf-8');
}

export function writeDesktopWindowStateSync(paths: DesktopPaths, state: DesktopWindowState): void {
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(statePath(paths), serializeWindowState(state), 'utf-8');
}

export function captureDesktopWindowState(window: BrowserWindow): DesktopWindowState {
  const bounds = window.getNormalBounds();
  return {
    ...boundsToWindowState(bounds),
    maximized: window.isMaximized(),
  };
}

export function applyDesktopWindowState(
  state: DesktopWindowState,
  fallback = DEFAULT_DESKTOP_WINDOW_STATE,
  workAreas: readonly Rectangle[] = []
): Required<Pick<DesktopWindowState, 'width' | 'height'>> & Pick<DesktopWindowState, 'x' | 'y'> {
  const sanitized = sanitizeWindowState(state);
  const bounds = {
    width: sanitized.width || fallback.width,
    height: sanitized.height || fallback.height,
    x: sanitized.x,
    y: sanitized.y,
  };
  const areas = workAreas.filter(
    (area) =>
      [area.x, area.y, area.width, area.height].every(Number.isFinite) &&
      area.width > 0 &&
      area.height > 0
  );
  if (!areas.length) return bounds;
  // Electron's bounds and display work areas both use device-independent pixels.
  // Keep the monitor containing the largest part of the saved window. With no
  // intersection (disconnected display), use the first, primary work area.
  let area = areas[0];
  let largest = 0;
  if (bounds.x !== undefined && bounds.y !== undefined) {
    for (const candidate of areas) {
      const overlap =
        Math.max(
          0,
          Math.min(bounds.x + bounds.width, candidate.x + candidate.width) -
            Math.max(bounds.x, candidate.x)
        ) *
        Math.max(
          0,
          Math.min(bounds.y + bounds.height, candidate.y + candidate.height) -
            Math.max(bounds.y, candidate.y)
        );
      if (overlap > largest) {
        largest = overlap;
        area = candidate;
      }
    }
  }
  const width = Math.min(area.width, Math.max(DESKTOP_MIN_WINDOW.width, bounds.width));
  const height = Math.min(area.height, Math.max(DESKTOP_MIN_WINDOW.height, bounds.height));
  const x = largest > 0 && bounds.x !== undefined ? bounds.x : area.x + (area.width - width) / 2;
  const y = largest > 0 && bounds.y !== undefined ? bounds.y : area.y + (area.height - height) / 2;
  return {
    width,
    height,
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
  };
}

function boundsToWindowState(bounds: Rectangle): DesktopWindowState {
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  };
}

function sanitizeWindowState(state: DesktopWindowState): DesktopWindowState {
  return {
    width: clampDimension(state.width, DEFAULT_DESKTOP_WINDOW_STATE.width),
    height: clampDimension(state.height, DEFAULT_DESKTOP_WINDOW_STATE.height),
    x: sanitizePosition(state.x),
    y: sanitizePosition(state.y),
    maximized: Boolean(state.maximized),
  };
}

function serializeWindowState(state: DesktopWindowState): string {
  return JSON.stringify(sanitizeWindowState(state), null, 2);
}

function clampDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), 720), 4096)
    : fallback;
}

function sanitizePosition(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}
