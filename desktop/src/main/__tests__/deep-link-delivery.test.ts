import { EventEmitter } from 'node:events';
import type { IpcMain, WebContents } from 'electron';
import type {
  DesktopCommandDispatchRequest,
  DesktopCommandDispatchResult,
} from '@veritas-kanban/shared';
import { describe, expect, it, vi } from 'vitest';
import { DesktopDeepLinkDelivery } from '../deep-link-delivery.js';
import { parseDesktopDeepLink } from '../deep-links.js';

function windowTarget() {
  const mainFrame = { url: 'http://127.0.0.1:39101/' };
  return Object.assign(new EventEmitter(), {
    mainFrame,
    isDestroyed: () => false,
    getURL: () => mainFrame.url,
  });
}
function harness() {
  const ipc = new EventEmitter();
  let target = windowTarget();
  const dispatch = vi.fn(
    async (request: DesktopCommandDispatchRequest): Promise<DesktopCommandDispatchResult> => ({
      command: request.command,
      accepted: true,
      handledBy: 'renderer' as const,
    })
  );
  const report = vi.fn();
  const delivery = new DesktopDeepLinkDelivery({
    ipc: ipc as IpcMain,
    target: () => target as unknown as WebContents,
    origin: () => 'http://127.0.0.1:39101',
    dispatch,
    report,
  });
  const event = () => ({ sender: target, senderFrame: target.mainFrame });
  const ready = () => ipc.emit('desktop:menu-command-ready', event());
  return {
    ipc,
    dispatch,
    report,
    delivery,
    event,
    ready,
    target: () => target,
    replace: () => {
      target = windowTarget();
    },
    link: (id = 'task-one') =>
      delivery.enqueue(parseDesktopDeepLink(`veritas://task/${id}?tab=work-products`).command),
  };
}

describe('native deep link delivery', () => {
  it('retains cold-start links until the authenticated main renderer is ready', async () => {
    const h = harness();
    h.link();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.ready();
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(1));
    h.ready();
    await Promise.resolve();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls[0]?.[0].payload?.deepLink).toMatchObject({
      resourceId: 'task-one',
    });
    h.delivery.dispose();
  });

  it('ignores readiness from foreign windows, child frames and untrusted origins', async () => {
    const h = harness();
    h.link();
    h.ipc.emit('desktop:menu-command-ready', { ...h.event(), sender: windowTarget() });
    h.ipc.emit('desktop:menu-command-ready', {
      ...h.event(),
      senderFrame: { url: 'http://127.0.0.1:39101/' },
    });
    h.target().mainFrame.url = 'https://example.invalid/';
    h.ready();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.target().mainFrame.url = 'http://127.0.0.1:39101/';
    h.ready();
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(1));
    h.delivery.dispose();
  });

  it('retains links while locked and after a main-window reload or replacement', async () => {
    const h = harness();
    h.ready();
    h.ipc.emit('desktop:menu-command-not-ready', h.event());
    h.link('locked-task');
    expect(h.dispatch).not.toHaveBeenCalled();
    h.ready();
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(1));
    h.delivery.clearReady(h.target() as unknown as WebContents);
    h.link('reload-task');
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    h.replace();
    h.ready();
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(2));
    h.delivery.dispose();
  });

  it('serializes links arriving during dispatch without duplicate readiness dispatches', async () => {
    const h = harness();
    let finish!: (result: {
      command: 'open-command-center';
      accepted: true;
      handledBy: 'renderer';
    }) => void;
    h.dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    h.ready();
    h.link('first');
    h.link('second');
    h.ready();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    finish({ command: 'open-command-center', accepted: true, handledBy: 'renderer' });
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(2));
    expect(h.dispatch.mock.calls.map(([request]) => request.payload?.deepLink)).toMatchObject([
      { resourceId: 'first' },
      { resourceId: 'second' },
    ]);
    h.delivery.dispose();
  });

  it.each(['rejected', 'throw'] as const)(
    'visibly reports %s delivery once without automatic replay',
    async (outcome) => {
      const h = harness();
      if (outcome === 'rejected')
        h.dispatch.mockResolvedValueOnce({
          command: 'open-command-center',
          accepted: false,
          handledBy: 'renderer',
        });
      else h.dispatch.mockRejectedValueOnce(new Error('fixture dispatch failed'));
      h.link();
      h.ready();
      await vi.waitFor(() => expect(h.report).toHaveBeenCalledTimes(1));
      h.ready();
      await Promise.resolve();
      expect(h.dispatch).toHaveBeenCalledTimes(1);
      h.delivery.dispose();
    }
  );

  it('disposes listeners and undispatched links when the application quits', () => {
    const h = harness();
    h.link();
    h.delivery.dispose();
    h.ready();
    h.link('after-quit');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.ipc.listenerCount('desktop:menu-command-ready')).toBe(0);
    expect(h.ipc.listenerCount('desktop:menu-command-not-ready')).toBe(0);
  });
});
