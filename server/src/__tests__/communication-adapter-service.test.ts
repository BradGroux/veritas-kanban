import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ChatService } from '../services/chat-service.js';
import type { OutboundIntegrationService } from '../services/outbound-integration-service.js';
import { CommunicationAdapterService } from '../services/communication-adapter-service.js';

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
});
