import { describe, expect, it, vi } from 'vitest';

import {
  DesktopUpdateService,
  resolveDesktopUpdateChannel,
  type DesktopUpdateAdapter,
  type DesktopUpdateAdapterConfigureOptions,
} from '../updates.js';

type UpdateListener = (...args: unknown[]) => void;

class FakeUpdateAdapter implements DesktopUpdateAdapter {
  configure = vi.fn((options: DesktopUpdateAdapterConfigureOptions) => {
    this.config = options;
  });
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
  active = true;
  config: DesktopUpdateAdapterConfigureOptions | null = null;
  private readonly listeners = new Map<string, UpdateListener[]>();

  on(event: string, listener: UpdateListener): void {
    const existing = this.listeners.get(event) ?? [];
    this.listeners.set(event, [...existing, listener]);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  isUpdaterActive(): boolean {
    return this.active;
  }
}

function service(adapter = new FakeUpdateAdapter()) {
  const emitStatus = vi.fn();
  return {
    adapter,
    emitStatus,
    service: new DesktopUpdateService({
      adapter,
      packaged: true,
      currentVersion: '4.3.2',
      channel: 'stable',
      now: () => new Date('2026-05-31T00:00:00.000Z'),
      emitStatus,
    }),
  };
}

describe('desktop update service', () => {
  it('configures updater for manual download and stable channel release checks', () => {
    const harness = service();

    expect(harness.adapter.configure).toHaveBeenCalledWith({
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      channel: 'stable',
      forceDevUpdateConfig: false,
    });
    expect(harness.service.snapshot()).toMatchObject({
      state: 'idle',
      currentVersion: '4.3.2',
      channel: 'stable',
    });
  });

  it('emits available, downloading, and ready states from updater events', async () => {
    const harness = service();

    await harness.service.checkForUpdates();
    harness.adapter.emit('update-available', { version: '4.3.3' });
    harness.adapter.emit('download-progress', { percent: 55.2 });
    harness.adapter.emit('update-downloaded', { version: '4.3.3' });

    expect(harness.emitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'available', availableVersion: '4.3.3' })
    );
    expect(harness.emitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'downloading', detail: '55% downloaded.' })
    );
    expect(harness.service.snapshot()).toMatchObject({
      state: 'ready',
      availableVersion: '4.3.3',
    });
  });

  it('keeps dev builds unsupported unless force dev update config is enabled', async () => {
    const adapter = new FakeUpdateAdapter();
    const updateService = new DesktopUpdateService({
      adapter,
      packaged: false,
      currentVersion: '4.3.2',
      channel: 'dev',
    });

    await expect(updateService.checkForUpdates()).resolves.toMatchObject({
      state: 'unsupported',
    });
    expect(adapter.checkForUpdates).not.toHaveBeenCalled();
  });

  it('redacts sensitive update errors before publishing status', async () => {
    const harness = service();
    harness.adapter.checkForUpdates.mockRejectedValueOnce(
      new Error('download failed token=abc123 path=/Users/bradgroux/private')
    );

    await harness.service.checkForUpdates();

    expect(harness.service.snapshot()).toMatchObject({
      state: 'failed',
      detail: 'download failed token=[redacted] path=/Users/[redacted]/private',
    });
  });

  it('resolves stable, beta, and dev channels conservatively', () => {
    expect(resolveDesktopUpdateChannel(undefined, '4.3.2', true)).toBe('stable');
    expect(resolveDesktopUpdateChannel(undefined, '5.0.0-beta.1', true)).toBe('beta');
    expect(resolveDesktopUpdateChannel('dev', '4.3.2', true)).toBe('dev');
    expect(resolveDesktopUpdateChannel(undefined, '4.3.2', false)).toBe('dev');
  });
});
