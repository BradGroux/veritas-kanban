import { describe, expect, it } from 'vitest';
import { AcpJsonRpcPeer } from '@veritas-kanban/shared';

describe('ACP JSON-RPC peer writes', () => {
  it('contains transport teardown failures for detached request replies', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const peer = new AcpJsonRpcPeer({
        write: async () => {
          throw new Error('stream destroyed');
        },
        onRequest: async () => ({}),
      });

      peer.acceptChunk('{"jsonrpc":"2.0","id":1,"method":"session/request_permission"}\n');
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('keeps caller-awaited write failures observable', async () => {
    const peer = new AcpJsonRpcPeer({
      write: async () => {
        throw new Error('stream destroyed');
      },
    });

    await expect(peer.notify('session/cancel', {})).rejects.toThrow('stream destroyed');
  });
});
