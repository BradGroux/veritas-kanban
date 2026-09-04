import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createServerShutdown } from './server-shutdown.js';

describe('server shutdown', () => {
  it('finishes an already-connected request before disposing its storage', async () => {
    let disposed = false;
    const server = createServer((_req, res) => {
      res.writeHead(disposed ? 500 : 200);
      res.end(disposed ? 'storage disposed' : 'task response');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const accepted = once(server, 'connection');
    const socket = connect(address.port, '127.0.0.1');
    const connected = once(socket, 'connect');
    const [acceptedSocket] = await accepted;
    await connected;
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    const ended = once(socket, 'end');
    const received = once(acceptedSocket, 'data');
    socket.write('GET /tasks HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n');
    await received;
    let finishWebSockets!: () => void;
    const websockets = new Promise<void>((resolve) => {
      finishWebSockets = resolve;
    });
    const disposeServices = vi.fn(async () => {
      disposed = true;
    });
    const shutdown = createServerShutdown({
      server,
      closeWebSockets: () => websockets,
      disposeServices,
    });
    try {
      const first = shutdown();
      expect(shutdown()).toBe(first);
      finishWebSockets();
      // Release the remaining headers after shutdown has started. No timer race.
      await new Promise<void>((resolve) => setImmediate(resolve));
      socket.write('\r\n');
      await ended;
      await first;
      expect(Buffer.concat(chunks).toString()).toMatch(/^HTTP\/1.1 200 /);
      expect(disposeServices).toHaveBeenCalledTimes(1);
    } finally {
      socket.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  it('bounds a stalled drain without disposing resources if it eventually completes', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const closeWebSockets = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const disposeServices = vi.fn(async () => {});
    const shutdown = createServerShutdown({
      server: createServer(),
      closeWebSockets,
      disposeServices,
      timeoutMs: 20,
    });
    try {
      const pending = shutdown();
      const rejected = expect(pending).rejects.toThrow('deadline exceeded');
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(shutdown()).toBe(pending);
      expect(closeWebSockets).toHaveBeenCalledTimes(1);
      expect(disposeServices).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates disposal failures and cancels the deadline', async () => {
    vi.useFakeTimers();
    const failure = new Error('registry flush failed');
    const disposeServices = vi.fn(async () => {
      throw failure;
    });
    const shutdown = createServerShutdown({
      server: createServer(),
      closeWebSockets: async () => {},
      disposeServices,
    });
    try {
      const result = expect(shutdown()).rejects.toBe(failure);
      await vi.advanceTimersByTimeAsync(0);
      await result;
      expect(vi.getTimerCount()).toBe(0);
      expect(disposeServices).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('also bounds disposal that never finishes', async () => {
    vi.useFakeTimers();
    const disposeServices = vi.fn(() => new Promise<void>(() => {}));
    const shutdown = createServerShutdown({
      server: createServer(),
      closeWebSockets: async () => {},
      disposeServices,
      timeoutMs: 20,
    });
    try {
      const pending = shutdown();
      const rejected = expect(pending).rejects.toThrow('deadline exceeded');
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      expect(disposeServices).toHaveBeenCalledTimes(1);
      expect(shutdown()).toBe(pending);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
