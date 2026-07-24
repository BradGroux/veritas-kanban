import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
}));

const { mockSafeFetch } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn(),
}));

const { mockCommunicationAdapters, mockBroadcastSquadMessage } = vi.hoisted(() => ({
  mockCommunicationAdapters: {
    listAdapters: vi.fn(),
    getAdapter: vi.fn(),
    configureAdapter: vi.fn(),
    checkHealth: vi.fn(),
    send: vi.fn(),
    ingestReply: vi.fn(),
    pollReplies: vi.fn(),
    disconnectAdapter: vi.fn(),
    listMappings: vi.fn(),
    listDeliveries: vi.fn(),
  },
  mockBroadcastSquadMessage: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

vi.mock('../../utils/url-validation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/url-validation.js')>();
  return {
    ...actual,
    safeFetch: mockSafeFetch,
  };
});

const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}));

vi.mock('../../services/config-service.js', () => ({
  ConfigService: function () {
    return {
      getConfig: mockGetConfig,
    };
  },
}));

vi.mock('../../services/communication-adapter-service.js', () => ({
  DEFAULT_ADAPTER_ID: 'msteams-default',
  getCommunicationAdapterService: () => mockCommunicationAdapters,
}));

vi.mock('../../services/broadcast-service.js', () => ({
  broadcastSquadMessage: mockBroadcastSquadMessage,
}));

import { integrationsRoutes } from '../../routes/integrations.js';
import { getOutboundIntegrationService } from '../../services/outbound-integration-service.js';

interface TestAuthRequest extends Request {
  auth?: { role: string; permissions: string[] };
}

interface TestError extends Error {
  statusCode?: number;
  code?: string;
}

describe('integrations routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
    } as unknown as Response);
    mockCommunicationAdapters.listAdapters.mockResolvedValue([]);
    mockCommunicationAdapters.getAdapter.mockResolvedValue({
      id: 'msteams-default',
      kind: 'msteams',
      displayName: 'Microsoft Teams',
      enabled: true,
    });
    mockCommunicationAdapters.configureAdapter.mockResolvedValue({
      id: 'msteams-default',
      kind: 'msteams',
      displayName: 'Microsoft Teams',
      enabled: true,
      webhookUrl: 'https://example.com/hooks/teams',
      webhookUrlConfigured: true,
      webhookUrlRedacted: true,
      hasCredential: true,
    });
    mockCommunicationAdapters.checkHealth.mockResolvedValue({
      adapterId: 'msteams-default',
      status: 'ok',
      configured: true,
      canSend: true,
      canReceiveReplies: true,
      checkedAt: '2026-06-26T18:00:00.000Z',
      detail: 'ok',
    });
    mockCommunicationAdapters.send.mockResolvedValue({
      delivery: {
        id: 'comm_1',
        adapterId: 'msteams-default',
        operation: 'send',
        status: 'queued',
        createdAt: '2026-06-26T18:00:00.000Z',
      },
      mapping: {
        id: 'map_1',
        adapterId: 'msteams-default',
        externalThreadId: 'thread-1',
        target: { kind: 'notification' },
        createdAt: '2026-06-26T18:00:00.000Z',
        updatedAt: '2026-06-26T18:00:00.000Z',
      },
    });
    mockCommunicationAdapters.ingestReply.mockResolvedValue({
      delivery: {
        id: 'comm_2',
        adapterId: 'msteams-default',
        operation: 'reply-ingest',
        status: 'success',
        createdAt: '2026-06-26T18:01:00.000Z',
      },
      mapping: {
        id: 'map_1',
        adapterId: 'msteams-default',
        externalThreadId: 'thread-1',
        target: { kind: 'squad', squadMessageId: 'msg_root' },
        createdAt: '2026-06-26T18:00:00.000Z',
        updatedAt: '2026-06-26T18:01:00.000Z',
      },
      squadMessageId: 'msg_reply',
      squadMessage: {
        id: 'msg_reply',
        agent: 'alice',
        message: 'reply',
        timestamp: '2026-06-26T18:01:00.000Z',
      },
    });
    mockCommunicationAdapters.pollReplies.mockResolvedValue({
      delivery: {
        id: 'comm_3',
        adapterId: 'msteams-default',
        operation: 'poll',
        status: 'skipped',
        createdAt: '2026-06-26T18:02:00.000Z',
      },
      replies: [],
    });
    mockCommunicationAdapters.disconnectAdapter.mockResolvedValue({
      id: 'msteams-default',
      kind: 'msteams',
      displayName: 'Microsoft Teams',
      enabled: false,
      hasCredential: false,
    });
    mockCommunicationAdapters.listMappings.mockResolvedValue([]);
    mockCommunicationAdapters.listDeliveries.mockResolvedValue([]);
    app = express();
    app.use(express.json());
    app.use((req: TestAuthRequest, _res: Response, next: NextFunction) => {
      req.auth = { role: 'read-only', permissions: ['settings:read'] };
      next();
    });
    app.use('/api/integrations', integrationsRoutes);
    app.use((err: TestError, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode || 500).json({ code: err.code || 'ERROR', message: err.message });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks localhost/private targets (SSRF guard)', async () => {
    mockGetConfig.mockResolvedValue({
      coolify: {
        services: {
          n8n: { url: 'http://127.0.0.1:5678', token: '' },
        },
      },
    });

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('down');
    expect(res.body.data.n8n.error).toBe('blocked host');
  });

  it('blocks DNS resolutions that point to private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.4', family: 4 }]);
    mockGetConfig.mockResolvedValue({
      coolify: {
        services: {
          n8n: { url: 'https://example.com', token: '' },
        },
      },
    });

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('down');
    expect(res.body.data.n8n.error).toBe('blocked host');
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('marks service up when reachable', async () => {
    mockGetConfig.mockResolvedValue({
      coolify: {
        services: {
          n8n: { url: 'https://example.com', token: '' },
        },
      },
    });

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('up');
    expect(mockLookup).toHaveBeenCalledWith('example.com', { all: true });
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
      { allowHttp: true }
    );
  });

  it('exposes sanitized outbound endpoint and delivery history', async () => {
    const endpointId = `route-test.${Date.now()}`;
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 202,
      text: vi.fn().mockResolvedValue('accepted'),
    } as unknown as Response);

    const delivery = await getOutboundIntegrationService().deliver(
      {
        id: endpointId,
        type: 'squad-webhook',
        displayName: 'Route test webhook',
        url: 'https://example.com/outbound?token=query-secret',
        auth: {
          type: 'bearer',
          secretRef: 'featureSettings.squadWebhook.secret',
          hasSecret: true,
        },
        owner: { source: 'runtime', resourceId: 'route-test' },
      },
      {
        method: 'POST',
        headers: { Authorization: 'Bearer raw-token-value' },
        body: '{}',
      }
    );

    expect(delivery.ok).toBe(true);

    const endpointsRes = await request(app).get('/api/integrations/outbound/endpoints');
    expect(endpointsRes.status).toBe(200);
    const endpoint = endpointsRes.body.find((entry: { id: string }) => entry.id === endpointId);
    expect(endpoint).toMatchObject({
      id: endpointId,
      url: 'https://example.com/outbound',
      auth: {
        type: 'bearer',
        secretRef: 'featureSettings.squadWebhook.secret',
        hasSecret: true,
      },
    });

    const deliveriesRes = await request(app).get('/api/integrations/outbound/deliveries?limit=10');
    expect(deliveriesRes.status).toBe(200);
    const attempt = deliveriesRes.body.find(
      (entry: { endpointId: string }) => entry.endpointId === endpointId
    );
    expect(attempt).toMatchObject({
      endpointId,
      sanitizedUrl: 'https://example.com/outbound',
      status: 'success',
      responseStatus: 202,
    });

    const responsePayload = JSON.stringify({ endpoint, attempt });
    expect(responsePayload).not.toContain('query-secret');
    expect(responsePayload).not.toContain('raw-token-value');
  });

  it('configures communication adapters without exposing secrets', async () => {
    const res = await request(app)
      .put('/api/integrations/communication/adapters/msteams-default')
      .send({
        displayName: 'Microsoft Teams',
        enabled: true,
        deliveryMode: 'webhook',
        webhookUrl: 'https://example.com/hooks/teams?token=query-secret',
        credential: 'raw-secret',
      });

    expect(res.status).toBe(200);
    expect(mockCommunicationAdapters.configureAdapter).toHaveBeenCalledWith(
      'msteams-default',
      expect.objectContaining({ credential: 'raw-secret' })
    );
    expect(JSON.stringify(res.body)).not.toContain('query-secret');
    expect(JSON.stringify(res.body)).not.toContain('raw-secret');
    expect(res.body).toMatchObject({
      webhookUrl: 'https://example.com/hooks/teams',
      webhookUrlConfigured: true,
      webhookUrlRedacted: true,
      hasCredential: true,
    });
  });

  it('configures a reference-only Buzz adapter and runs a read-only test probe', async () => {
    const buzzRecord = {
      id: 'buzz-default',
      kind: 'buzz',
      displayName: 'Buzz',
      enabled: true,
      deliveryMode: 'manual',
      replyMode: 'ingest-api',
      destinationType: 'channel',
      relayHttpUrl: 'https://relay.example.test',
      relayWebSocketUrl: 'wss://relay.example.test',
      expectedCommunity: 'relay.example.test',
      publicKey: 'ab'.repeat(32),
      publicKeyFingerprint: 'public-fp',
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      authTagConfigured: false,
      hasCredential: true,
      createdAt: '2026-07-23T18:00:00.000Z',
      updatedAt: '2026-07-23T18:00:00.000Z',
    };
    mockCommunicationAdapters.configureAdapter.mockResolvedValueOnce(buzzRecord);

    const configured = await request(app)
      .put('/api/integrations/communication/adapters/buzz-default')
      .send({
        kind: 'buzz',
        relayHttpUrl: 'https://relay.example.test',
        expectedCommunity: 'relay.example.test',
        publicKey: 'ab'.repeat(32),
        credentialRef: 'env:BUZZ_PRIVATE_KEY',
      });

    expect(configured.status).toBe(200);
    expect(configured.body).toMatchObject({
      kind: 'buzz',
      credentialRef: 'env:BUZZ_PRIVATE_KEY',
      hasCredential: true,
    });
    expect(JSON.stringify(configured.body)).not.toContain('nsec');

    mockCommunicationAdapters.getAdapter
      .mockResolvedValueOnce(buzzRecord)
      .mockResolvedValueOnce(buzzRecord);
    mockCommunicationAdapters.checkHealth.mockResolvedValueOnce({
      adapterId: 'buzz-default',
      status: 'healthy',
      configured: true,
      canSend: false,
      canReceiveReplies: false,
      checkedAt: '2026-07-23T18:01:00.000Z',
      detail: 'Buzz read-only compatibility probe passed.',
      reasonCode: 'ok',
    });

    const tested = await request(app)
      .post('/api/integrations/communication/adapters/buzz-default/test')
      .send({ message: 'must not be sent' });

    expect(tested.status).toBe(200);
    expect(tested.body).toMatchObject({
      status: 'healthy',
      canSend: false,
      canReceiveReplies: false,
    });
    expect(mockCommunicationAdapters.checkHealth).toHaveBeenCalledWith('buzz-default');
    expect(mockCommunicationAdapters.send).not.toHaveBeenCalledWith(
      'buzz-default',
      expect.anything()
    );
  });

  it('rejects raw Buzz credentials and API-token fields', async () => {
    const res = await request(app)
      .put('/api/integrations/communication/adapters/buzz-default')
      .send({
        kind: 'buzz',
        relayHttpUrl: 'https://relay.example.test',
        publicKey: 'ab'.repeat(32),
        credentialRef: 'env:BUZZ_PRIVATE_KEY',
        credential: 'raw-secret',
        apiTokenRef: 'env:BUZZ_TOKEN',
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
    });
    expect(mockCommunicationAdapters.configureAdapter).not.toHaveBeenCalledWith(
      'buzz-default',
      expect.anything()
    );
  });

  it('ingests communication replies and broadcasts the resulting squad message', async () => {
    const res = await request(app)
      .post('/api/integrations/communication/adapters/msteams-default/replies')
      .send({
        externalThreadId: 'thread-1',
        externalReplyId: 'reply-1',
        actor: 'alice',
        message: 'Looks good',
        target: { kind: 'squad', squadMessageId: 'msg_root' },
      });

    expect(res.status).toBe(201);
    expect(mockCommunicationAdapters.ingestReply).toHaveBeenCalledWith(
      'msteams-default',
      expect.objectContaining({ externalReplyId: 'reply-1' })
    );
    expect(mockBroadcastSquadMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg_reply' })
    );
  });

  it('rejects approval replies without approval-capable permissions', async () => {
    const res = await request(app)
      .post('/api/integrations/communication/adapters/msteams-default/replies')
      .send({
        externalThreadId: 'thread-1',
        actor: 'alice',
        message: 'approve',
        target: { kind: 'approval', approvalId: 'approval-1' },
      });

    expect(res.status).toBe(403);
    expect(mockCommunicationAdapters.ingestReply).not.toHaveBeenCalled();
  });
});
