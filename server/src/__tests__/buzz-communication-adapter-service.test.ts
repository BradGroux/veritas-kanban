import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { ChatService } from '../services/chat-service.js';
import type { OutboundIntegrationService } from '../services/outbound-integration-service.js';
import type { BuzzCompatibilityService } from '../services/buzz-compatibility-service.js';
import type { BuzzCommunicationService } from '../services/buzz-communication-service.js';
import type { BuzzWorkflowTriggerService } from '../services/buzz-workflow-trigger-service.js';
import {
  BUZZ_DELETE_KIND,
  BUZZ_EDIT_KIND,
  BUZZ_MESSAGE_KIND,
} from '../services/buzz-communication-service.js';
import {
  CommunicationAdapterService,
  type CommunicationAdapterServiceOptions,
} from '../services/communication-adapter-service.js';
import type {
  BuzzSubscriptionWorkerCallbacks,
  BuzzSubscriptionWorkerConfig,
  BuzzSubscriptionWorkerFactory,
  BuzzSubscriptionWorkerHandle,
} from '../services/buzz-subscription-worker.js';

const CHANNEL_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_CHANNEL_ID = '223e4567-e89b-42d3-a456-426614174000';
const COMMUNITY = 'relay.example.test';
const ADAPTER_ID = 'buzz-default';

function healthyCompatibility(publicKey: string) {
  return {
    schemaVersion: 'buzz-compatibility/v1' as const,
    probeRevision: 1 as const,
    testedRelease: '0.4.24' as const,
    testedCommit: '710ed9fff57878a1d69f809b80a6ee0416c53fc4' as const,
    status: 'healthy' as const,
    reasonCode: 'ok' as const,
    detail: 'Buzz relay and read capabilities are compatible.',
    configuredRelayHttpUrl: `https://${COMMUNITY}`,
    resolvedRelayHttpUrl: `https://${COMMUNITY}`,
    resolvedRelayWebSocketUrl: `wss://${COMMUNITY}`,
    expectedCommunity: COMMUNITY,
    observedCommunity: COMMUNITY,
    publicKeyFingerprint: publicKey.slice(0, 12),
    checks: {
      relayIdentity: 'verified' as const,
      communityBinding: 'verified' as const,
      configuredIdentity: 'verified' as const,
      authentication: 'verified' as const,
      membership: 'verified' as const,
      channelRead: 'verified' as const,
      messageRead: 'verified' as const,
    },
    commands: [],
    evidenceKey: 'evidence-key',
    checkedAt: '2026-07-23T20:00:00.000Z',
  };
}

class FakeWorkerFactory implements BuzzSubscriptionWorkerFactory {
  readonly created: Array<{
    config: BuzzSubscriptionWorkerConfig;
    callbacks: BuzzSubscriptionWorkerCallbacks;
    handle: BuzzSubscriptionWorkerHandle;
  }> = [];

  create(config: BuzzSubscriptionWorkerConfig, callbacks: BuzzSubscriptionWorkerCallbacks) {
    const handle = {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    this.created.push({ config, callbacks, handle });
    return handle;
  }
}

describe('Buzz communication adapter', () => {
  let temporaryDirectory: string;
  let authorSecretKey: Uint8Array;
  let authorPublicKey: string;
  let chatService: Pick<ChatService, 'sendSquadMessage' | 'getSquadMessages'>;
  let buzzCommunication: {
    prepareMessage: ReturnType<typeof vi.fn>;
    submitEvent: ReturnType<typeof vi.fn>;
    eventExists: ReturnType<typeof vi.fn>;
  };
  let workerFactory: FakeWorkerFactory;
  let buzzWorkflowTriggers: { processEvent: ReturnType<typeof vi.fn> };
  let service: CommunicationAdapterService;

  function event(input: {
    content: string;
    createdAt?: number;
    kind?: number;
    rootEventId?: string;
    parentEventId?: string;
    tags?: string[][];
  }) {
    const tags: string[][] = [['h', CHANNEL_ID]];
    if (input.rootEventId && input.parentEventId) {
      if (input.rootEventId === input.parentEventId) {
        tags.push(['e', input.rootEventId, '', 'reply']);
      } else {
        tags.push(['e', input.rootEventId, '', 'root']);
        tags.push(['e', input.parentEventId, '', 'reply']);
      }
    } else if (input.rootEventId) {
      tags.push(['e', input.rootEventId]);
    }
    tags.push(...(input.tags ?? []));
    return finalizeEvent(
      {
        kind: input.kind ?? BUZZ_MESSAGE_KIND,
        created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
        tags,
        content: input.content,
      },
      authorSecretKey
    );
  }

  async function configure() {
    await service.configureAdapter(ADAPTER_ID, {
      kind: 'buzz',
      enabled: true,
      relayHttpUrl: `https://${COMMUNITY}`,
      expectedCommunity: COMMUNITY,
      publicKey: authorPublicKey,
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
    });
    const mapping = await service.configureBuzzChannelMapping(ADAPTER_ID, CHANNEL_ID, {
      target: { kind: 'squad' },
      actor: 'operator',
    });
    await service.checkHealth(ADAPTER_ID);
    return mapping;
  }

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'buzz-communication-adapter-'));
    authorSecretKey = generateSecretKey();
    authorPublicKey = getPublicKey(authorSecretKey);
    chatService = {
      sendSquadMessage: vi.fn(async (input, displayName) => ({
        id: input.id ?? `msg_${vi.mocked(chatService.sendSquadMessage).mock.calls.length}`,
        agent: input.agent,
        displayName,
        message: input.message,
        timestamp: input.timestamp ?? new Date().toISOString(),
        replyToId: input.replyToId,
        taskId: input.taskId,
        runId: input.runId,
        tags: input.tags,
        links: input.links,
        external: input.external,
      })),
      getSquadMessages: vi.fn().mockResolvedValue([]),
    } as unknown as Pick<ChatService, 'sendSquadMessage' | 'getSquadMessages'>;
    buzzCommunication = {
      prepareMessage: vi.fn(),
      submitEvent: vi.fn(),
      eventExists: vi.fn(),
    };
    workerFactory = new FakeWorkerFactory();
    buzzWorkflowTriggers = { processEvent: vi.fn().mockResolvedValue([]) };
    const options: CommunicationAdapterServiceOptions = {
      storageDir: temporaryDirectory,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: {
        deliver: vi.fn(),
      } as unknown as OutboundIntegrationService,
      buzzCompatibility: {
        probe: vi.fn().mockResolvedValue(healthyCompatibility(authorPublicKey)),
      } as unknown as BuzzCompatibilityService,
      buzzCommunication: buzzCommunication as unknown as BuzzCommunicationService,
      buzzWorkerFactory: workerFactory,
      buzzWorkflowTriggers: buzzWorkflowTriggers as unknown as BuzzWorkflowTriggerService,
      audit: vi.fn().mockResolvedValue(undefined),
    };
    service = new CommunicationAdapterService(options);
  });

  afterEach(async () => {
    await service.shutdown();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('rejects conflicting channel-to-target mappings and retains disabled mappings', async () => {
    const mapping = await configure();
    await expect(
      service.configureBuzzChannelMapping(ADAPTER_ID, OTHER_CHANNEL_ID, {
        target: { kind: 'squad' },
      })
    ).rejects.toThrow('already mapped');

    await service.disableBuzzChannelMapping(ADAPTER_ID, CHANNEL_ID, 'operator');
    expect(await service.listBuzzChannelMappings(ADAPTER_ID)).toEqual([
      expect.objectContaining({
        id: mapping.id,
        channelId: CHANNEL_ID,
        enabled: false,
      }),
    ]);
    const state = JSON.parse(
      await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8')
    );
    expect(state.buzzChannelMappings[mapping.id]).toMatchObject({ enabled: false });
    expect(state.buzzCursors).toEqual({});
  });

  it('persists a signed outbound event before send and reconciles ambiguity by event ID', async () => {
    await configure();
    const outboundEvent = event({ content: 'outbound root' });
    buzzCommunication.prepareMessage.mockResolvedValue({
      event: outboundEvent,
      coordinate: {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        eventId: outboundEvent.id,
        authorPubkey: outboundEvent.pubkey,
        kind: BUZZ_MESSAGE_KIND,
        externalUrl: `buzz://message?channel=${CHANNEL_ID}&id=${outboundEvent.id}`,
      },
    });
    buzzCommunication.submitEvent.mockResolvedValue({
      status: 'delivery_unknown',
      eventId: outboundEvent.id,
      detail: 'connection closed after write',
    });

    const result = await service.send(ADAPTER_ID, {
      target: { kind: 'squad', squadMessageId: 'msg_local_root' },
      message: 'outbound root',
      actor: 'VERITAS',
    });
    expect(result.delivery).toMatchObject({
      status: 'delivery_unknown',
      buzz: { eventId: outboundEvent.id, channelId: CHANNEL_ID },
    });
    const persisted = JSON.parse(
      await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8')
    );
    expect(persisted.buzzOutbound[outboundEvent.id]).toMatchObject({
      status: 'delivery_unknown',
      attemptCount: 1,
      squadMessageId: 'msg_local_root',
      event: { id: outboundEvent.id },
    });

    buzzCommunication.eventExists.mockResolvedValue(true);
    const reconciled = await service.pollReplies(ADAPTER_ID);
    expect(reconciled.delivery.status).toBe('success');
    expect(buzzCommunication.eventExists).toHaveBeenCalledWith(
      expect.any(Object),
      outboundEvent.id
    );
    expect(buzzCommunication.submitEvent).toHaveBeenCalledTimes(1);
  });

  it('resubmits the exact signed event only after a definitive absence check', async () => {
    await configure();
    const outboundEvent = event({ content: 'outbound root' });
    buzzCommunication.prepareMessage.mockResolvedValue({
      event: outboundEvent,
      coordinate: {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        eventId: outboundEvent.id,
        authorPubkey: outboundEvent.pubkey,
        kind: BUZZ_MESSAGE_KIND,
      },
    });
    buzzCommunication.submitEvent
      .mockResolvedValueOnce({
        status: 'delivery_unknown',
        eventId: outboundEvent.id,
      })
      .mockResolvedValueOnce({ status: 'accepted', eventId: outboundEvent.id });
    buzzCommunication.eventExists.mockResolvedValue(false);

    await service.send(ADAPTER_ID, {
      target: { kind: 'squad' },
      message: 'outbound root',
    });
    await service.pollReplies(ADAPTER_ID);

    expect(buzzCommunication.submitEvent).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      outboundEvent
    );
    const state = JSON.parse(
      await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8')
    );
    expect(state.buzzOutbound[outboundEvent.id]).toMatchObject({
      status: 'accepted',
      attemptCount: 2,
    });
  });

  it('never reconciles a tampered persisted outbound event', async () => {
    await configure();
    const outboundEvent = event({ content: 'signed content' });
    buzzCommunication.prepareMessage.mockResolvedValue({
      event: outboundEvent,
      coordinate: {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        eventId: outboundEvent.id,
        authorPubkey: outboundEvent.pubkey,
        kind: BUZZ_MESSAGE_KIND,
      },
    });
    buzzCommunication.submitEvent.mockResolvedValue({
      status: 'delivery_unknown',
      eventId: outboundEvent.id,
    });
    await service.send(ADAPTER_ID, {
      target: { kind: 'squad' },
      message: 'signed content',
    });
    await service.shutdown();

    const statePath = path.join(temporaryDirectory, 'state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state.buzzOutbound[outboundEvent.id].event.content = 'tampered content';
    await fs.writeFile(statePath, JSON.stringify(state));
    buzzCommunication.eventExists.mockClear();
    buzzCommunication.submitEvent.mockClear();
    service = new CommunicationAdapterService({
      storageDir: temporaryDirectory,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: { deliver: vi.fn() } as unknown as OutboundIntegrationService,
      buzzCompatibility: {
        probe: vi.fn().mockResolvedValue(healthyCompatibility(authorPublicKey)),
      } as unknown as BuzzCompatibilityService,
      buzzCommunication: buzzCommunication as unknown as BuzzCommunicationService,
      buzzWorkerFactory: workerFactory,
      audit: vi.fn().mockResolvedValue(undefined),
    });

    expect((await service.pollReplies(ADAPTER_ID)).delivery).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('rejected 1'),
    });
    expect(buzzCommunication.eventExists).not.toHaveBeenCalled();
    expect(buzzCommunication.submitEvent).not.toHaveBeenCalled();
  });

  it('projects inbound roots and replies exactly once with external metadata', async () => {
    const mapping = await configure();
    const root = event({ content: '<b>root</b>' });
    const reply = event({
      content: 'reply',
      rootEventId: root.id,
      parentEventId: root.id,
    });

    const rootDelivery = await service.ingestBuzzEvent(ADAPTER_ID, mapping, root);
    const replyDelivery = await service.ingestBuzzEvent(ADAPTER_ID, mapping, reply);
    const duplicate = await service.ingestBuzzEvent(ADAPTER_ID, mapping, reply);

    expect(rootDelivery).toMatchObject({
      status: 'success',
      squadMessageId: `msg_buzz_${root.id}`,
    });
    expect(replyDelivery).toMatchObject({
      status: 'success',
      squadMessageId: `msg_buzz_${reply.id}`,
      buzz: { rootEventId: root.id, parentEventId: root.id },
    });
    expect(duplicate.status).toBe('replayed');
    expect(chatService.sendSquadMessage).toHaveBeenCalledTimes(2);
    expect(buzzWorkflowTriggers.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterId: ADAPTER_ID,
        mapping,
        eventId: root.id,
        content: 'root',
        rootEventId: undefined,
      })
    );
    expect(chatService.sendSquadMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: `msg_buzz_${root.id}`,
        agent: 'BUZZ',
        message: 'root',
        links: [
          expect.objectContaining({
            href: expect.stringContaining(`id=${root.id}`),
            label: 'Open in Buzz',
          }),
        ],
        external: expect.objectContaining({
          provider: 'buzz',
          messageId: root.id,
          authorId: authorPublicKey,
        }),
      }),
      expect.stringContaining(authorPublicKey.slice(0, 12))
    );
    expect(chatService.sendSquadMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        replyToId: `msg_buzz_${root.id}`,
        timestamp: new Date(reply.created_at * 1000).toISOString(),
      }),
      expect.any(String)
    );
  });

  it('publishes a mapped Veritas reply with the Buzz root and parent coordinates', async () => {
    const mapping = await configure();
    const root = event({ content: 'Buzz root' });
    await service.ingestBuzzEvent(ADAPTER_ID, mapping, root);
    const outboundReply = event({
      content: 'Veritas reply',
      rootEventId: root.id,
      parentEventId: root.id,
    });
    buzzCommunication.prepareMessage.mockResolvedValue({
      event: outboundReply,
      coordinate: {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        eventId: outboundReply.id,
        authorPubkey: outboundReply.pubkey,
        kind: BUZZ_MESSAGE_KIND,
        rootEventId: root.id,
        parentEventId: root.id,
      },
    });
    buzzCommunication.submitEvent.mockResolvedValue({
      status: 'accepted',
      eventId: outboundReply.id,
    });

    const result = await service.send(ADAPTER_ID, {
      target: { kind: 'squad', squadMessageId: 'msg_local_reply' },
      replyToSquadMessageId: `msg_buzz_${root.id}`,
      message: 'Veritas reply',
    });

    expect(result.delivery.status).toBe('success');
    expect(buzzCommunication.prepareMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        channelId: CHANNEL_ID,
        rootEventId: root.id,
        parentEventId: root.id,
      })
    );
    const state = JSON.parse(
      await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8')
    );
    expect(state.buzzOutbound[outboundReply.id]).toMatchObject({
      squadMessageId: 'msg_local_reply',
      coordinate: { rootEventId: root.id, parentEventId: root.id },
    });
  });

  it('holds an out-of-order reply without advancing the cursor, then drains it after the root', async () => {
    const mapping = await configure();
    const root = event({ content: 'late root', createdAt: Math.floor(Date.now() / 1000) - 20 });
    const reply = event({
      content: 'early reply',
      createdAt: root.created_at + 10,
      rootEventId: root.id,
      parentEventId: root.id,
    });

    expect(await service.ingestBuzzEvent(ADAPTER_ID, mapping, reply)).toMatchObject({
      status: 'queued',
    });
    let state = JSON.parse(await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8'));
    expect(Object.keys(state.buzzCursors)).toHaveLength(0);
    expect(Object.keys(state.buzzPendingEvents)).toHaveLength(1);

    await service.ingestBuzzEvent(ADAPTER_ID, mapping, root);
    expect(chatService.sendSquadMessage).toHaveBeenCalledTimes(2);
    expect(chatService.sendSquadMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ replyToId: `msg_buzz_${root.id}` }),
      expect.any(String)
    );
    state = JSON.parse(await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8'));
    expect(Object.keys(state.buzzPendingEvents)).toHaveLength(0);
    expect(Object.values(state.buzzCursors)[0]).toMatchObject({
      createdAt: reply.created_at,
      eventId: reply.id,
    });
  });

  it('drains persisted pending replies when an already-projected root is replayed after restart', async () => {
    const mapping = await configure();
    const root = event({
      content: 'persisted root',
      createdAt: Math.floor(Date.now() / 1000) - 20,
    });
    const reply = event({
      content: 'persisted pending reply',
      createdAt: root.created_at + 10,
      rootEventId: root.id,
      parentEventId: root.id,
    });

    expect(await service.ingestBuzzEvent(ADAPTER_ID, mapping, reply)).toMatchObject({
      status: 'queued',
    });
    const statePath = path.join(temporaryDirectory, 'state.json');
    const persisted = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const rootKey = `${COMMUNITY}:${root.id}`;
    persisted.buzzEvents[rootKey] = {
      key: rootKey,
      adapterId: ADAPTER_ID,
      direction: 'inbound',
      coordinate: {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        eventId: root.id,
        authorPubkey: root.pubkey,
        kind: BUZZ_MESSAGE_KIND,
      },
      squadMessageId: `msg_buzz_${root.id}`,
      recordedAt: new Date().toISOString(),
    };
    await fs.writeFile(statePath, JSON.stringify(persisted));
    await service.shutdown();

    service = new CommunicationAdapterService({
      storageDir: temporaryDirectory,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: { deliver: vi.fn() } as unknown as OutboundIntegrationService,
      buzzCompatibility: {
        probe: vi.fn().mockResolvedValue(healthyCompatibility(authorPublicKey)),
      } as unknown as BuzzCompatibilityService,
      buzzCommunication: buzzCommunication as unknown as BuzzCommunicationService,
      buzzWorkerFactory: new FakeWorkerFactory(),
      audit: vi.fn().mockResolvedValue(undefined),
    });

    expect(await service.ingestBuzzEvent(ADAPTER_ID, mapping, root)).toMatchObject({
      status: 'replayed',
    });
    expect(chatService.sendSquadMessage).toHaveBeenCalledTimes(1);
    expect(chatService.sendSquadMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `msg_buzz_${reply.id}`,
        replyToId: `msg_buzz_${root.id}`,
      }),
      expect.any(String)
    );
    const recovered = JSON.parse(await fs.readFile(statePath, 'utf8'));
    expect(Object.keys(recovered.buzzPendingEvents)).toHaveLength(0);
    expect(Object.values(recovered.buzzCursors)[0]).toMatchObject({
      createdAt: reply.created_at,
      eventId: reply.id,
    });
  });

  it('suppresses its own outbound echo and records edits and deletes without local mutation', async () => {
    const mapping = await configure();
    const outboundEvent = event({ content: 'outbound root' });
    buzzCommunication.prepareMessage.mockResolvedValue({
      event: outboundEvent,
      coordinate: {
        community: COMMUNITY,
        channelId: CHANNEL_ID,
        eventId: outboundEvent.id,
        authorPubkey: outboundEvent.pubkey,
        kind: BUZZ_MESSAGE_KIND,
      },
    });
    buzzCommunication.submitEvent.mockResolvedValue({
      status: 'accepted',
      eventId: outboundEvent.id,
    });
    await service.send(ADAPTER_ID, {
      target: { kind: 'squad' },
      message: 'outbound root',
    });
    expect(await service.ingestBuzzEvent(ADAPTER_ID, mapping, outboundEvent)).toMatchObject({
      status: 'ignored',
      detail: expect.stringContaining('reply loop'),
    });

    const delayedEcho = event({
      content: 'outbound record already pruned',
      tags: [
        ['client', 'veritas-kanban'],
        ['veritas-id', 'delivery-pruned'],
      ],
    });
    expect(await service.ingestBuzzEvent(ADAPTER_ID, mapping, delayedEcho)).toMatchObject({
      status: 'ignored',
      detail: expect.stringContaining('reply loop'),
    });

    const edit = event({
      content: 'edited',
      kind: BUZZ_EDIT_KIND,
      rootEventId: outboundEvent.id,
    });
    const deletion = event({
      content: '',
      kind: BUZZ_DELETE_KIND,
      rootEventId: outboundEvent.id,
    });
    expect(await service.ingestBuzzEvent(ADAPTER_ID, mapping, edit)).toMatchObject({
      status: 'ignored',
      detail: expect.stringContaining('no edit projection'),
    });
    expect(await service.ingestBuzzEvent(ADAPTER_ID, mapping, deletion)).toMatchObject({
      status: 'ignored',
      detail: expect.stringContaining('not removed'),
    });
    expect(chatService.sendSquadMessage).not.toHaveBeenCalled();
  });

  it('starts from a five-second overlap cursor and closes the worker on disable', async () => {
    const mapping = await configure();
    const root = event({ content: 'cursor root' });
    await service.ingestBuzzEvent(ADAPTER_ID, mapping, root);
    await service.shutdown();

    const reloadedFactory = new FakeWorkerFactory();
    const reloaded = new CommunicationAdapterService({
      storageDir: temporaryDirectory,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: { deliver: vi.fn() } as unknown as OutboundIntegrationService,
      buzzCompatibility: {
        probe: vi.fn().mockResolvedValue(healthyCompatibility(authorPublicKey)),
      } as unknown as BuzzCompatibilityService,
      buzzCommunication: buzzCommunication as unknown as BuzzCommunicationService,
      buzzWorkerFactory: reloadedFactory,
      audit: vi.fn().mockResolvedValue(undefined),
    });
    await reloaded.start();
    const worker = reloadedFactory.created.at(-1);
    expect(worker?.config.cursors).toEqual([
      expect.objectContaining({ eventId: root.id, createdAt: root.created_at }),
    ]);

    await reloaded.disconnectAdapter(ADAPTER_ID);
    expect(worker?.handle.stop).toHaveBeenCalled();
    const state = JSON.parse(
      await fs.readFile(path.join(temporaryDirectory, 'state.json'), 'utf8')
    );
    expect(Object.keys(state.buzzChannelMappings)).toHaveLength(1);
    expect(Object.keys(state.buzzCursors)).toHaveLength(1);
    await reloaded.shutdown();
  });
});
