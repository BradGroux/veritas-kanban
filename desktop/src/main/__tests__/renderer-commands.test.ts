import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain, WebContents } from 'electron';
import { sendAcknowledgedRendererCommand } from '../renderer-commands.js';

function harness() {
  const ipc = new EventEmitter();
  const target = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    mainFrame: {},
    send: vi.fn(),
  });
  const request = { command: 'new-task' as const, source: 'menu' as const };
  const dispatch = () =>
    sendAcknowledgedRendererCommand(ipc as IpcMain, target as unknown as WebContents, request, 100);
  const receipt = (accepted = true) => ({
    requestId: target.send.mock.calls[0][1].requestId,
    accepted,
  });
  const event = { sender: target, senderFrame: target.mainFrame };
  return { ipc, target, request, dispatch, receipt, event };
}
afterEach(() => vi.useRealTimers());
describe('renderer command receipts', () => {
  it('waits for the matching window and request and removes listeners', async () => {
    const h = harness();
    const finished = vi.fn();
    const result = h.dispatch().then(finished);
    h.ipc.emit('desktop:menu-command-result', { sender: {} }, h.receipt());
    h.ipc.emit('desktop:menu-command-result', h.event, { requestId: 'another', accepted: true });
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    h.ipc.emit('desktop:menu-command-result', h.event, h.receipt());
    await result;
    expect(finished).toHaveBeenCalledWith(
      expect.objectContaining({ accepted: true, handledBy: 'renderer' })
    );
    expect(h.ipc.listenerCount('desktop:menu-command-result')).toBe(0);
    expect(h.target.listenerCount('destroyed')).toBe(0);
  });
  it('returns renderer permission failures without claiming success', async () => {
    const h = harness();
    const result = h.dispatch();
    h.ipc.emit('desktop:menu-command-result', h.event, {
      ...h.receipt(false),
      message: 'Permission required',
    });
    await expect(result).resolves.toMatchObject({
      accepted: false,
      message: 'Permission required',
    });
  });
  it('fails closed when setup or a locked renderer has no listener', async () => {
    vi.useFakeTimers();
    const h = harness();
    const result = h.dispatch();
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({
      accepted: false,
      message: expect.stringContaining('unlock'),
    });
    expect(h.ipc.listenerCount('desktop:menu-command-result')).toBe(0);
  });
  it('settles a destroyed or missing window', async () => {
    const h = harness();
    const result = h.dispatch();
    h.target.emit('destroyed');
    await expect(result).resolves.toMatchObject({ accepted: false });
    await expect(
      sendAcknowledgedRendererCommand(h.ipc as IpcMain, undefined, h.request)
    ).resolves.toMatchObject({ accepted: false });
  });
});
