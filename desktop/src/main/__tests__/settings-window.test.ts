import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMain } from 'electron';
import { SettingsWindowController } from '../settings-window.js';

function harness() {
  const ipc = new EventEmitter();
  let destroyed = false;
  let quitting = false;
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => destroyed,
    send: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => destroyed,
    loadURL: vi.fn(async () => {}),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: () => true,
    destroy: vi.fn(() => {
      destroyed = true;
      contents.emit('destroyed');
      window.emit('closed');
    }),
  });
  const createWindow = vi.fn(() => window as unknown as BrowserWindow);
  const returnFocus = vi.fn();
  const controller = new SettingsWindowController({
    ipc: ipc as IpcMain,
    createWindow,
    origin: () => 'http://127.0.0.1:43210/',
    quitting: () => quitting,
    returnFocus,
    readyTimeoutMs: 100,
  });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const ready = () => ipc.emit('desktop:menu-command-ready', event);
  const acknowledge = (accepted = true) => {
    for (const [, request] of contents.send.mock.calls)
      ipc.emit('desktop:menu-command-result', event, { requestId: request.requestId, accepted });
  };
  return {
    ipc,
    window,
    contents,
    controller,
    ready,
    acknowledge,
    createWindow,
    returnFocus,
    event,
    quit: () => {
      quitting = true;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('native Settings ownership', () => {
  it('reuses one window for concurrent requests, waits for its renderer, and hides on close', async () => {
    const h = harness();
    const first = h.controller.open({ command: 'open-settings' });
    const second = h.controller.open({ command: 'open-settings' });
    expect(h.createWindow).toHaveBeenCalledOnce();
    expect(h.window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:43210/?desktop-settings=1');
    h.ipc.emit('desktop:menu-command-ready', { ...h.event, senderFrame: {} });
    await Promise.resolve();
    expect(h.contents.send).not.toHaveBeenCalled();
    h.ready();
    await Promise.resolve();
    expect(h.window.show).not.toHaveBeenCalled();
    h.acknowledge();
    expect((await first).accepted).toBe(true);
    expect((await second).accepted).toBe(true);
    const event = { preventDefault: vi.fn() };
    h.window.emit('close', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.window.hide).toHaveBeenCalledOnce();
    expect(h.returnFocus).toHaveBeenCalledOnce();
    const third = h.controller.open({ command: 'open-settings' });
    await Promise.resolve();
    h.acknowledge();
    await third;
    expect(h.createWindow).toHaveBeenCalledOnce();
    h.quit();
    const quitEvent = { preventDefault: vi.fn() };
    h.window.emit('close', quitEvent);
    expect(quitEvent.preventDefault).not.toHaveBeenCalled();
    h.window.destroy();
    expect(h.ipc.listenerCount('desktop:menu-command-ready')).toBe(0);
  });
  it('waits for pending-save acknowledgement before quit and retains a rejected editing session', async () => {
    const h = harness();
    const opening = h.controller.open({ command: 'open-settings' });
    h.ready();
    await Promise.resolve();
    h.acknowledge();
    await opening;
    const quitting = h.controller.prepareToQuit();
    await Promise.resolve();
    expect(h.contents.send.mock.lastCall?.[1].payload).toEqual({ flushPending: true });
    h.acknowledge(false);
    expect(await quitting).toBe(false);
    expect(h.window.destroy).not.toHaveBeenCalled();
    h.ipc.emit('desktop:menu-command-not-ready', h.event);
    expect(await h.controller.prepareToQuit()).toBe(true);
    h.window.destroy();
  });
  it('fails closed and discards only a never-ready renderer when authentication/setup is unavailable', async () => {
    vi.useFakeTimers();
    const h = harness();
    const opening = h.controller.open({ command: 'open-settings' });
    await vi.advanceTimersByTimeAsync(100);
    expect(await opening).toMatchObject({
      accepted: false,
      message: expect.stringContaining('unlock'),
    });
    expect(h.window.destroy).toHaveBeenCalledOnce();
    expect(h.controller.getWindow()).toBeNull();
    expect(h.ipc.listenerCount('desktop:menu-command-ready')).toBe(0);
  });
});
