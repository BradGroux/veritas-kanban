import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ChatService } from '../services/chat-service.js';
import type { OutboundIntegrationService } from '../services/outbound-integration-service.js';
import { CommunicationAdapterService } from '../services/communication-adapter-service.js';
import type { BuzzCompatibilityService } from '../services/buzz-compatibility-service.js';

describe('CommunicationAdapterService', () => {
  let tmpDir: string;
  let audit: ReturnType<typeof vi.fn>;
  let chatService: Pick<ChatService, 'sendSquadMessage' | 'getSquadMessages'>;
  let outboundIntegrations: Pick<OutboundIntegrationService, 'deliver'>;
  let service: CommunicationAdapterService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'communication-adapter-'));
    audit = vi.fn().mockResolvedValue(undefined);
    chatService = {
      sendSquadMessage: vi.fn(),
      getSquadMessages: vi.fn(),
    } as unknown as Pick<ChatService, 'sendSquadMessage' | 'getSquadMessages'>;
    outboundIntegrations = {
      deliver: vi.fn().mockResolvedValue({ ok: true, status: 'success', attemptId: 'out_1' }),
    } as unknown as Pick<OutboundIntegrationService, 'deliver'>;
    service = new CommunicationAdapterService({
      storageDir: tmpDir,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: outboundIntegrations as OutboundIntegrationService,
      audit,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('stores adapter posture without returning credentials or sensitive URL parts', async () => {
    const adapter = await service.configureAdapter('msteams-default', {
      displayName: 'Ops Teams',
      enabled: true,
      deliveryMode: 'webhook',
      destinationType: 'channel',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      channelId: 'channel-1',
      webhookUrl: 'https://example.com/hooks/teams?token=query-secret',
      credential: 'raw-access-token',
    });

    expect(adapter).toMatchObject({
      id: 'msteams-default',
      displayName: 'Ops Teams',
      enabled: true,
      webhookUrl: 'https://example.com/hooks/teams',
      webhookUrlConfigured: true,
      webhookUrlRedacted: true,
      hasCredential: true,
    });
    expect(JSON.stringify(adapter)).not.toContain('query-secret');
    expect(JSON.stringify(adapter)).not.toContain('raw-access-token');

    const health = await service.checkHealth('msteams-default');
    expect(health).toMatchObject({
      status: 'ok',
      configured: true,
      canSend: true,
      canReceiveReplies: true,
    });
  });

  it('sends through webhook delivery and records an external thread mapping', async () => {
    await service.configureAdapter('msteams-default', {
      enabled: true,
      deliveryMode: 'webhook',
      webhookUrl: 'https://example.com/hooks/teams?token=query-secret',
    });

    const result = await service.send('msteams-default', {
      target: { kind: 'squad', squadMessageId: 'msg_root' },
      message: 'Need a human reply',
      actor: 'veritas',
    });

    expect(result.delivery).toMatchObject({
      operation: 'send',
      status: 'success',
      externalThreadId: 'msteams-default:squad:msg_root',
    });
    expect(result.mapping).toMatchObject({
      externalThreadId: 'msteams-default:squad:msg_root',
      target: { kind: 'squad', squadMessageId: 'msg_root' },
    });
    expect(outboundIntegrations.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'communication-adapter-webhook',
        url: 'https://example.com/hooks/teams?token=query-secret',
      }),
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(JSON.stringify(result)).not.toContain('query-secret');
  });

  it('ingests external replies as sanitized Squad Chat replies and dedupes retry IDs', async () => {
    await service.configureAdapter('msteams-default', {
      enabled: true,
      deliveryMode: 'manual',
      channelId: 'channel-1',
    });
    const squadReply = {
      id: 'msg_reply',
      agent: 'alice@example.com',
      displayName: 'Alice',
      message: 'Approved Bearer [REDACTED]',
      timestamp: '2026-06-26T18:00:00.000Z',
    };
    vi.mocked(chatService.sendSquadMessage).mockResolvedValue(squadReply);
    vi.mocked(chatService.getSquadMessages).mockResolvedValue([squadReply]);

    const first = await service.ingestReply('msteams-default', {
      externalThreadId: 'teams-thread-1',
      externalReplyId: 'reply-1',
      actor: 'alice@example.com',
      displayName: 'Alice',
      message: '<b>Approved</b> Bearer abcdefghijklmnopqrstuvwxyz1234567890',
      target: { kind: 'squad', squadMessageId: 'msg_root', taskId: 'task-1' },
    });

    expect(first.delivery.status).toBe('success');
    expect(chatService.sendSquadMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'alice@example.com',
        message: 'Approved Bearer [REDACTED]',
        replyToId: 'msg_root',
        taskId: 'task-1',
        tags: ['external-reply', 'adapter:msteams', 'target:squad'],
      }),
      'Alice'
    );

    const retry = await service.ingestReply('msteams-default', {
      externalThreadId: 'teams-thread-1',
      externalReplyId: 'reply-1',
      actor: 'alice@example.com',
      displayName: 'Alice',
      message: 'duplicate',
      target: { kind: 'squad', squadMessageId: 'msg_root', taskId: 'task-1' },
    });

    expect(retry.delivery).toMatchObject({ status: 'skipped', squadMessageId: 'msg_reply' });
    expect(chatService.sendSquadMessage).toHaveBeenCalledTimes(1);
  });

  it('blocks inbound replies when the adapter is disabled', async () => {
    await service.configureAdapter('msteams-default', {
      enabled: false,
      deliveryMode: 'manual',
      channelId: 'channel-1',
    });

    const result = await service.ingestReply('msteams-default', {
      externalThreadId: 'teams-thread-1',
      externalReplyId: 'reply-1',
      actor: 'alice@example.com',
      displayName: 'Alice',
      message: 'Approved',
      target: { kind: 'squad', squadMessageId: 'msg_root', taskId: 'task-1' },
    });

    expect(result.delivery).toMatchObject({
      operation: 'reply-ingest',
      status: 'blocked',
      error: 'Adapter disabled',
    });
    expect(result.squadMessageId).toBe('');
    expect(chatService.sendSquadMessage).not.toHaveBeenCalled();
    expect(await service.listMappings('msteams-default')).toEqual([]);
  });

  it('stores only Buzz secret references and returns exact probe health', async () => {
    const buzzCompatibility = {
      probe: vi.fn().mockResolvedValue({
        schemaVersion: 'buzz-compatibility/v1',
        probeRevision: 1,
        testedRelease: '0.4.24',
        testedCommit: '710ed9fff57878a1d69f809b80a6ee0416c53fc4',
        status: 'healthy',
        reasonCode: 'ok',
        detail: 'Buzz relay and read capabilities are compatible.',
        configuredRelayHttpUrl: 'https://relay.example.test',
        resolvedRelayHttpUrl: 'https://relay.example.test',
        resolvedRelayWebSocketUrl: 'wss://relay.example.test',
        expectedCommunity: 'relay.example.test',
        observedCommunity: 'relay.example.test',
        publicKeyFingerprint: 'abc123abc123',
        checks: {
          relayIdentity: 'verified',
          communityBinding: 'verified',
          configuredIdentity: 'verified',
          authentication: 'verified',
          membership: 'verified',
          channelRead: 'verified',
          messageRead: 'verified',
        },
        commands: [],
        evidenceKey: 'evidence-key',
        checkedAt: '2026-07-23T18:00:00.000Z',
      }),
    } as unknown as BuzzCompatibilityService;
    service = new CommunicationAdapterService({
      storageDir: tmpDir,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: outboundIntegrations as OutboundIntegrationService,
      buzzCompatibility,
      audit,
    });

    const adapter = await service.configureAdapter('buzz-default', {
      kind: 'buzz',
      enabled: true,
      relayHttpUrl: 'https://relay.example.test',
      expectedCommunity: 'relay.example.test',
      publicKey: 'ab'.repeat(32),
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      authTagRef: 'env:BUZZ_AUTH_TAG',
    });
    const health = await service.checkHealth('buzz-default');
    const persisted = await fs.readFile(path.join(tmpDir, 'state.json'), 'utf-8');

    expect(adapter).toMatchObject({
      kind: 'buzz',
      relayHttpUrl: 'https://relay.example.test',
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      authTagConfigured: true,
      hasCredential: true,
    });
    expect(adapter.relayWebSocketUrl).toBeUndefined();
    expect(health).toMatchObject({
      status: 'healthy',
      reasonCode: 'ok',
      canSend: false,
      canReceiveReplies: false,
    });
    expect(persisted).toContain('env:BUZZ_PRIVATE_KEY');
    expect(persisted).not.toContain('nsec');
    expect(persisted).not.toContain('raw-access-token');

    const cleared = await service.configureAdapter('buzz-default', {
      kind: 'buzz',
      relayHttpUrl: 'https://relay.example.test',
      publicKey: 'ab'.repeat(32),
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      relayWebSocketUrl: null,
      expectedCommunity: null,
      authTagRef: null,
      command: null,
    });
    expect(cleared).toMatchObject({
      authTagConfigured: false,
    });
    expect(cleared.relayWebSocketUrl).toBeUndefined();
    expect(cleared.expectedCommunity).toBeUndefined();
    expect(cleared.authTagRef).toBeUndefined();
    expect(cleared.command).toBeUndefined();
  });

  it('quarantines an invalid persisted Buzz command before it can execute', async () => {
    await service.configureAdapter('buzz-default', {
      kind: 'buzz',
      enabled: true,
      relayHttpUrl: 'https://relay.example.test',
      publicKey: 'ab'.repeat(32),
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      command: { executable: '/opt/buzz/bin/buzz-agent', args: ['--profile', 'safe'] },
    });
    const statePath = path.join(tmpDir, 'state.json');
    const persisted = JSON.parse(await fs.readFile(statePath, 'utf8'));
    persisted.adapters['buzz-default'].command = {
      executable: '/bin/sh',
      args: ['-c', 'echo unsafe'],
    };
    await fs.writeFile(statePath, JSON.stringify(persisted));

    const probe = vi.fn();
    const reloaded = new CommunicationAdapterService({
      storageDir: tmpDir,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: outboundIntegrations as OutboundIntegrationService,
      buzzCompatibility: { probe } as unknown as BuzzCompatibilityService,
      audit,
    });

    expect(await reloaded.getAdapter('buzz-default')).toMatchObject({
      kind: 'buzz',
      enabled: false,
      hasCredential: false,
    });
    expect((await reloaded.getAdapter('buzz-default'))?.command).toBeUndefined();
    expect(await reloaded.checkHealth('buzz-default')).toMatchObject({
      status: 'misconfigured',
      reasonCode: 'configuration_invalid',
    });
    expect(probe).not.toHaveBeenCalled();
    expect(await fs.readFile(statePath, 'utf8')).not.toContain('/bin/sh');
  });

  it('invalidates persisted Buzz compatibility from an older probe contract', async () => {
    const buzzCompatibility = {
      probe: vi.fn().mockResolvedValue({
        schemaVersion: 'buzz-compatibility/v1',
        probeRevision: 1,
        testedRelease: '0.4.24',
        testedCommit: '710ed9fff57878a1d69f809b80a6ee0416c53fc4',
        status: 'healthy',
        reasonCode: 'ok',
        detail: 'compatible',
        configuredRelayHttpUrl: 'https://relay.example.test',
        publicKeyFingerprint: 'abc123abc123',
        checks: {
          relayIdentity: 'verified',
          communityBinding: 'verified',
          configuredIdentity: 'verified',
          authentication: 'verified',
          membership: 'verified',
          channelRead: 'verified',
          messageRead: 'verified',
        },
        commands: [],
        evidenceKey: 'evidence-key',
        checkedAt: '2026-07-23T18:00:00.000Z',
      }),
    } as unknown as BuzzCompatibilityService;
    const configured = new CommunicationAdapterService({
      storageDir: tmpDir,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: outboundIntegrations as OutboundIntegrationService,
      buzzCompatibility,
      audit,
    });
    await configured.configureAdapter('buzz-default', {
      kind: 'buzz',
      relayHttpUrl: 'https://relay.example.test',
      publicKey: 'ab'.repeat(32),
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
    });
    await configured.checkHealth('buzz-default');

    const statePath = path.join(tmpDir, 'state.json');
    const persisted = JSON.parse(await fs.readFile(statePath, 'utf8'));
    persisted.adapters['buzz-default'].compatibility.probeRevision = 0;
    await fs.writeFile(statePath, JSON.stringify(persisted));

    const reloaded = new CommunicationAdapterService({
      storageDir: tmpDir,
      persist: true,
      chatService: chatService as ChatService,
      outboundIntegrations: outboundIntegrations as OutboundIntegrationService,
      audit,
    });
    const adapter = await reloaded.getAdapter('buzz-default');
    expect(adapter?.compatibility).toBeUndefined();
    expect(adapter?.lastHealth).toBeUndefined();
  });

  it('fails closed for Buzz sends while leaving Microsoft Teams behavior intact', async () => {
    await service.configureAdapter('buzz-default', {
      kind: 'buzz',
      enabled: true,
      relayHttpUrl: 'https://relay.example.test',
      publicKey: 'ab'.repeat(32),
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
    });

    const result = await service.send('buzz-default', {
      target: { kind: 'squad', squadMessageId: 'message-1' },
      message: 'must not leave Veritas',
    });

    expect(result.delivery).toMatchObject({
      operation: 'send',
      status: 'blocked',
      error: expect.stringContaining('not implemented'),
    });
    expect(await service.listMappings('buzz-default')).toEqual([]);

    const poll = await service.pollReplies('buzz-default');
    expect(poll.delivery).toMatchObject({
      operation: 'poll',
      status: 'skipped',
      error: expect.stringContaining('Buzz reply polling is not implemented'),
    });
    expect(outboundIntegrations.deliver).not.toHaveBeenCalled();
  });
});
