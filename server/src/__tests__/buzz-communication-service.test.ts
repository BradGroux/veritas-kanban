import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { BuzzProbeConfig } from '../services/buzz-compatibility-service.js';
import {
  BUZZ_DELETE_KIND,
  BUZZ_EDIT_KIND,
  BUZZ_MESSAGE_KIND,
  BuzzCommunicationService,
  buildBuzzMessageDeepLink,
  parseBuzzInboundEvent,
} from '../services/buzz-communication-service.js';

const CHANNEL_ID = '123e4567-e89b-42d3-a456-426614174000';
const COMMUNITY = 'relay.example.test';
const NOW = new Date('2026-07-23T20:00:00.000Z');

function credentials() {
  const secretKey = generateSecretKey();
  const privateKey = Buffer.from(secretKey).toString('hex');
  return { secretKey, privateKey, publicKey: getPublicKey(secretKey) };
}

function config(publicKey: string): BuzzProbeConfig {
  return {
    enabled: true,
    relayHttpUrl: `https://${COMMUNITY}`,
    expectedCommunity: COMMUNITY,
    publicKey,
    credentialRef: 'env:BUZZ_PRIVATE_KEY',
  };
}

function signedEvent(
  secretKey: Uint8Array,
  input: {
    kind?: number;
    content?: string;
    tags?: string[][];
    createdAt?: number;
  } = {}
) {
  return finalizeEvent(
    {
      kind: input.kind ?? BUZZ_MESSAGE_KIND,
      created_at: input.createdAt ?? Math.floor(NOW.getTime() / 1000),
      tags: input.tags ?? [['h', CHANNEL_ID]],
      content: input.content ?? 'hello from Buzz',
    },
    secretKey
  );
}

describe('BuzzCommunicationService', () => {
  it('signs exact root, direct-reply, and nested-reply tags', async () => {
    const identity = credentials();
    const service = new BuzzCommunicationService({
      resolveSecret: vi.fn().mockResolvedValue(identity.privateKey),
      now: () => NOW,
    });
    const root = await service.prepareMessage(config(identity.publicKey), {
      channelId: CHANNEL_ID,
      content: 'root',
      idempotencyKey: 'delivery-root',
    });
    expect(root.event.kind).toBe(BUZZ_MESSAGE_KIND);
    expect(root.event.tags).toEqual([
      ['h', CHANNEL_ID],
      ['client', 'veritas-kanban'],
      ['veritas-id', 'delivery-root'],
    ]);

    const rootEventId = 'a'.repeat(64);
    const direct = await service.prepareMessage(config(identity.publicKey), {
      channelId: CHANNEL_ID,
      content: 'direct reply',
      idempotencyKey: 'delivery-direct',
      rootEventId,
      parentEventId: rootEventId,
    });
    expect(direct.event.tags).toContainEqual(['e', rootEventId, '', 'reply']);
    expect(direct.coordinate).toMatchObject({
      rootEventId,
      parentEventId: rootEventId,
      channelId: CHANNEL_ID,
    });

    const parentEventId = 'b'.repeat(64);
    const nested = await service.prepareMessage(config(identity.publicKey), {
      channelId: CHANNEL_ID,
      content: 'nested reply',
      idempotencyKey: 'delivery-nested',
      rootEventId,
      parentEventId,
    });
    expect(nested.event.tags).toContainEqual(['e', rootEventId, '', 'root']);
    expect(nested.event.tags).toContainEqual(['e', parentEventId, '', 'reply']);
  });

  it('rejects a signing key that does not match the configured public key', async () => {
    const identity = credentials();
    const service = new BuzzCommunicationService({
      resolveSecret: vi.fn().mockResolvedValue(identity.privateKey),
      now: () => NOW,
    });

    await expect(
      service.prepareMessage(config('f'.repeat(64)), {
        channelId: CHANNEL_ID,
        content: 'must not send',
        idempotencyKey: 'delivery-mismatch',
      })
    ).rejects.toThrow('does not match');
  });

  it('classifies accepted, rejected, and ambiguous acknowledgements without blind retry', async () => {
    const identity = credentials();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ event_id: 'a'.repeat(64), accepted: true }), {
          status: 202,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: false, message: 'membership denied' }), {
          status: 403,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 202 }))
      .mockRejectedValueOnce(new Error('socket closed after write'));
    const service = new BuzzCommunicationService({
      fetch,
      resolveSecret: vi.fn().mockResolvedValue(identity.privateKey),
      nip98Signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed',
          publicKey: identity.publicKey,
        }),
      },
    });
    const event = { ...signedEvent(identity.secretKey), id: 'a'.repeat(64) };

    await expect(service.submitEvent(config(identity.publicKey), event)).resolves.toMatchObject({
      status: 'accepted',
      eventId: event.id,
    });
    await expect(service.submitEvent(config(identity.publicKey), event)).resolves.toMatchObject({
      status: 'rejected',
      detail: 'membership denied',
    });
    await expect(service.submitEvent(config(identity.publicKey), event)).resolves.toMatchObject({
      status: 'delivery_unknown',
      detail: expect.stringContaining('did not confirm'),
    });
    await expect(service.submitEvent(config(identity.publicKey), event)).resolves.toMatchObject({
      status: 'delivery_unknown',
      detail: 'socket closed after write',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('queries a signed event ID for safe reconciliation', async () => {
    const identity = credentials();
    const eventId = 'c'.repeat(64);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: eventId }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const service = new BuzzCommunicationService({
      fetch,
      resolveSecret: vi.fn().mockResolvedValue(identity.privateKey),
      nip98Signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed',
          publicKey: identity.publicKey,
        }),
      },
    });

    await expect(service.eventExists(config(identity.publicKey), eventId)).resolves.toBe(true);
    await expect(service.eventExists(config(identity.publicKey), eventId)).resolves.toBe(false);
    await expect(service.eventExists(config(identity.publicKey), eventId)).resolves.toBeUndefined();
  });

  it('uses the signed DNS-pinned query transport for bounded definition reads', async () => {
    const identity = credentials();
    const definitions = [{ id: 'd'.repeat(64), kind: 30_175 }];
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(definitions), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const service = new BuzzCommunicationService({
      fetch,
      resolveSecret: vi.fn().mockResolvedValue(identity.privateKey),
      nip98Signer: {
        sign: vi.fn().mockResolvedValue({
          authorization: 'Nostr signed',
          publicKey: identity.publicKey,
        }),
      },
    });

    await expect(
      service.queryEvents(config(identity.publicKey), [{ kinds: [30_175, 30_176], limit: 200 }])
    ).resolves.toEqual(definitions);
    expect(fetch).toHaveBeenCalledWith(
      `https://${COMMUNITY}/query`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Nostr signed' }),
        body: JSON.stringify([{ kinds: [30_175, 30_176], limit: 200 }]),
      }),
      expect.objectContaining({ logFailures: false })
    );
    await expect(
      service.queryEvents(config(identity.publicKey), [{ kinds: [30_177], limit: 1 }])
    ).rejects.toThrow('outside the allowed definition bounds');
  });
});

describe('Buzz inbound event contract', () => {
  it('verifies authorship and preserves root, parent, timestamp, and deep-link coordinates', () => {
    const identity = credentials();
    const rootEventId = 'a'.repeat(64);
    const parentEventId = 'b'.repeat(64);
    const event = signedEvent(identity.secretKey, {
      tags: [
        ['h', CHANNEL_ID],
        ['e', rootEventId, '', 'root'],
        ['e', parentEventId, '', 'reply'],
      ],
    });

    expect(
      parseBuzzInboundEvent(event, { community: COMMUNITY, channelId: CHANNEL_ID, now: NOW })
    ).toMatchObject({
      event: { id: event.id, pubkey: identity.publicKey },
      content: 'hello from Buzz',
      coordinate: {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        eventId: event.id,
        authorPubkey: identity.publicKey,
        rootEventId,
        parentEventId,
        externalUrl: buildBuzzMessageDeepLink({
          channelId: CHANNEL_ID,
          eventId: event.id,
          rootEventId,
        }),
      },
    });
  });

  it.each([
    ['wrong channel', { tags: [['h', '223e4567-e89b-42d3-a456-426614174000']] }],
    ['future timestamp', { createdAt: Math.floor(NOW.getTime() / 1000) + 301 }],
    ['unknown kind', { kind: 99_999 }],
  ])('rejects %s events', (_label, override) => {
    const identity = credentials();
    const event = signedEvent(identity.secretKey, override);
    expect(() =>
      parseBuzzInboundEvent(event, { community: COMMUNITY, channelId: CHANNEL_ID, now: NOW })
    ).toThrow();
  });

  it('rejects invalid signatures and oversized content', () => {
    const identity = credentials();
    const event = signedEvent(identity.secretKey);
    expect(() =>
      parseBuzzInboundEvent(
        { ...event, content: 'tampered' },
        { community: COMMUNITY, channelId: CHANNEL_ID, now: NOW }
      )
    ).toThrow('signature');

    const oversized = signedEvent(identity.secretKey, { content: 'x'.repeat(64 * 1024 + 1) });
    expect(() =>
      parseBuzzInboundEvent(oversized, {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        now: NOW,
      })
    ).toThrow('message limit');
  });

  it.each([BUZZ_EDIT_KIND, BUZZ_DELETE_KIND])('extracts the target event for kind %i', (kind) => {
    const identity = credentials();
    const target = 'd'.repeat(64);
    const event = signedEvent(identity.secretKey, {
      kind,
      tags: [
        ['h', CHANNEL_ID],
        ['e', target],
      ],
    });
    expect(
      parseBuzzInboundEvent(event, { community: COMMUNITY, channelId: CHANNEL_ID, now: NOW })
    ).toMatchObject({ targetEventId: target, coordinate: { kind } });
  });
});
