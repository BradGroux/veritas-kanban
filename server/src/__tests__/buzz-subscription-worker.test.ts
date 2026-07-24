import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { WebSocketServer, type WebSocket } from 'ws';
import type { BuzzRuntimeHealth } from '@veritas-kanban/shared';
import { BuzzCommunicationService } from '../services/buzz-communication-service.js';
import { BuzzSubscriptionWorker } from '../services/buzz-subscription-worker.js';

const CHANNEL_ID = '123e4567-e89b-42d3-a456-426614174000';

interface FakeRelay {
  server: Server;
  webSocketServer: WebSocketServer;
  url: string;
  frames: unknown[][];
  connections: number;
}

async function startRelay(
  onFrame: (relay: FakeRelay, socket: WebSocket, frame: unknown[]) => void
): Promise<FakeRelay> {
  const server = createServer();
  const webSocketServer = new WebSocketServer({ server });
  const relay = {
    server,
    webSocketServer,
    url: '',
    frames: [],
    connections: 0,
  };
  webSocketServer.on('connection', (socket) => {
    relay.connections += 1;
    socket.send(JSON.stringify(['AUTH', 'challenge-1']));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString('utf8')) as unknown[];
      relay.frames.push(frame);
      onFrame(relay, socket, frame);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  relay.url = `http://127.0.0.1:${address.port}`;
  return relay;
}

describe('BuzzSubscriptionWorker fake-relay contract', () => {
  const relays: FakeRelay[] = [];

  afterEach(async () => {
    await Promise.all(
      relays.splice(0).map(
        (relay) =>
          new Promise<void>((resolve) => {
            for (const client of relay.webSocketServer.clients) client.terminate();
            relay.webSocketServer.close(() => relay.server.close(() => resolve()));
          })
      )
    );
  });

  it('authenticates, subscribes with cursor overlap, dispatches events, and closes cleanly', async () => {
    const secretKey = generateSecretKey();
    const privateKey = Buffer.from(secretKey).toString('hex');
    const publicKey = getPublicKey(secretKey);
    const createdAt = Math.floor(Date.now() / 1000) - 10;
    const inbound = finalizeEvent(
      {
        kind: 9,
        created_at: createdAt,
        tags: [['h', CHANNEL_ID]],
        content: 'from fake relay',
      },
      secretKey
    );
    const relay = await startRelay((_relay, socket, frame) => {
      if (frame[0] === 'AUTH') {
        const auth = frame[1] as ReturnType<typeof finalizeEvent>;
        expect(verifyEvent(auth)).toBe(true);
        expect(auth.kind).toBe(22_242);
        expect(auth.tags).toContainEqual(['challenge', 'challenge-1']);
        expect(auth.tags).toContainEqual(['relay', relay.url.replace('http:', 'ws:')]);
        socket.send(JSON.stringify(['OK', auth.id, true, 'authenticated']));
      }
      if (frame[0] === 'REQ') {
        socket.send(JSON.stringify(['EOSE', frame[1]]));
        socket.send(JSON.stringify(['EVENT', frame[1], inbound]));
      }
    });
    relays.push(relay);

    const events = vi.fn().mockResolvedValue(undefined);
    const health: Array<Partial<BuzzRuntimeHealth>> = [];
    const worker = new BuzzSubscriptionWorker(
      {
        adapterId: 'buzz-default',
        probeConfig: {
          enabled: true,
          relayHttpUrl: relay.url,
          expectedCommunity: '127.0.0.1',
          publicKey,
          credentialRef: 'env:BUZZ_PRIVATE_KEY',
          allowLocalhost: true,
        },
        mappings: [
          {
            id: 'buzz_map_1',
            adapterId: 'buzz-default',
            community: '127.0.0.1',
            channelId: CHANNEL_ID,
            target: { kind: 'squad' },
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        cursors: [
          {
            adapterId: 'buzz-default',
            community: '127.0.0.1',
            channelId: CHANNEL_ID,
            createdAt,
            eventId: 'a'.repeat(64),
            committedAt: new Date().toISOString(),
          },
        ],
      },
      {
        onEvent: events,
        onHealth: (patch) => {
          health.push(patch);
        },
      },
      {
        communication: new BuzzCommunicationService({
          resolveSecret: vi.fn().mockResolvedValue(privateKey),
        }),
        random: () => 0.5,
      }
    );

    worker.start();
    await vi.waitFor(() => {
      expect(events).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: CHANNEL_ID }),
        expect.objectContaining({
          id: inbound.id,
          pubkey: inbound.pubkey,
          content: inbound.content,
        })
      );
      expect(health).toContainEqual(expect.objectContaining({ subscriptionActive: true }));
    });
    const request = relay.frames.find((frame) => frame[0] === 'REQ');
    expect(request).toEqual([
      'REQ',
      `vk-buzz-${CHANNEL_ID}`,
      {
        kinds: [9, 40_003, 9_005, 5],
        '#h': [CHANNEL_ID],
        since: createdAt - 5,
      },
    ]);

    await worker.stop();
    await vi.waitFor(() => {
      expect(relay.frames).toContainEqual(['CLOSE', `vk-buzz-${CHANNEL_ID}`]);
    });
    expect(health.at(-1)).toMatchObject({
      relayConnected: false,
      subscriptionActive: false,
    });
  });

  it('treats authentication rejection as terminal instead of reconnecting', async () => {
    const secretKey = generateSecretKey();
    const privateKey = Buffer.from(secretKey).toString('hex');
    const publicKey = getPublicKey(secretKey);
    const relay = await startRelay((_relay, socket, frame) => {
      if (frame[0] === 'AUTH') {
        const auth = frame[1] as { id: string };
        socket.send(JSON.stringify(['OK', auth.id, false, 'membership required']));
      }
    });
    relays.push(relay);
    const health: Array<Partial<BuzzRuntimeHealth>> = [];
    const worker = new BuzzSubscriptionWorker(
      {
        adapterId: 'buzz-default',
        probeConfig: {
          enabled: true,
          relayHttpUrl: relay.url,
          expectedCommunity: '127.0.0.1',
          publicKey,
          credentialRef: 'env:BUZZ_PRIVATE_KEY',
          allowLocalhost: true,
        },
        mappings: [
          {
            id: 'buzz_map_1',
            adapterId: 'buzz-default',
            community: '127.0.0.1',
            channelId: CHANNEL_ID,
            target: { kind: 'squad' },
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        cursors: [],
      },
      {
        onEvent: vi.fn(),
        onHealth: (patch) => {
          health.push(patch);
        },
      },
      {
        communication: new BuzzCommunicationService({
          resolveSecret: vi.fn().mockResolvedValue(privateKey),
        }),
      }
    );

    worker.start();
    await vi.waitFor(() => {
      expect(health).toContainEqual(
        expect.objectContaining({ lastError: expect.stringContaining('membership required') })
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(relay.connections).toBe(1);
    await worker.stop();
  });

  it('reconnects a transiently closed subscription and overlaps the initial cursor', async () => {
    const secretKey = generateSecretKey();
    const privateKey = Buffer.from(secretKey).toString('hex');
    const publicKey = getPublicKey(secretKey);
    const now = new Date('2026-07-23T20:00:00.000Z');
    const inbound = finalizeEvent(
      {
        kind: 9,
        created_at: Math.floor(now.getTime() / 1000) - 2,
        tags: [['h', CHANNEL_ID]],
        content: 'advance reconnect cursor',
      },
      secretKey
    );
    const relay = await startRelay((currentRelay, socket, frame) => {
      if (frame[0] === 'AUTH') {
        const auth = frame[1] as { id: string };
        socket.send(JSON.stringify(['OK', auth.id, true, 'authenticated']));
      }
      if (frame[0] === 'REQ') {
        if (currentRelay.connections === 1) {
          socket.send(JSON.stringify(['EVENT', frame[1], inbound]));
          socket.send(JSON.stringify(['CLOSED', frame[1], 'temporary relay throttle']));
        } else {
          socket.send(JSON.stringify(['EOSE', frame[1]]));
        }
      }
    });
    relays.push(relay);
    const health: Array<Partial<BuzzRuntimeHealth>> = [];
    const committedCursor = {
      adapterId: 'buzz-default',
      community: '127.0.0.1',
      channelId: CHANNEL_ID,
      createdAt: inbound.created_at,
      eventId: inbound.id,
      committedAt: now.toISOString(),
    };
    const worker = new BuzzSubscriptionWorker(
      {
        adapterId: 'buzz-default',
        probeConfig: {
          enabled: true,
          relayHttpUrl: relay.url,
          expectedCommunity: '127.0.0.1',
          publicKey,
          credentialRef: 'env:BUZZ_PRIVATE_KEY',
          allowLocalhost: true,
        },
        mappings: [
          {
            id: 'buzz_map_1',
            adapterId: 'buzz-default',
            community: '127.0.0.1',
            channelId: CHANNEL_ID,
            target: { kind: 'squad' },
            enabled: true,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        ],
        cursors: [],
      },
      {
        onEvent: vi.fn().mockResolvedValue(committedCursor),
        onHealth: (patch) => {
          health.push(patch);
        },
      },
      {
        communication: new BuzzCommunicationService({
          resolveSecret: vi.fn().mockResolvedValue(privateKey),
        }),
        now: () => now,
        random: () => 0,
      }
    );

    worker.start();
    await vi.waitFor(
      () => {
        expect(relay.connections).toBeGreaterThanOrEqual(2);
        expect(health).toContainEqual(expect.objectContaining({ subscriptionActive: true }));
      },
      { timeout: 2_000 }
    );
    const requests = relay.frames.filter((frame) => frame[0] === 'REQ');
    expect(requests[0]?.[2]).toMatchObject({
      since: Math.floor(now.getTime() / 1000) - 5,
    });
    expect(requests[1]?.[2]).toMatchObject({
      since: inbound.created_at - 5,
    });
    await worker.stop();
  });
});
