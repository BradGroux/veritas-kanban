import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireSquadWebhook } from '../services/squad-webhook-service.js';
import type { SquadMessage, SquadWebhookSettings } from '@veritas-kanban/shared';
import crypto from 'crypto';

describe('SquadWebhookService', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseMessage: SquadMessage = {
    id: 'msg-1',
    agent: 'jules',
    message: 'test message',
    timestamp: '2023-01-01T00:00:00Z',
  };

  const baseSettings: SquadWebhookSettings = {
    enabled: true,
    mode: 'generic',
    notifyOnHuman: true,
    notifyOnAgent: true,
    url: 'https://example.com/webhook',
  };

  it('does not fire if not enabled', async () => {
    await fireSquadWebhook(baseMessage, { ...baseSettings, enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fire if notifyOnHuman is false for human message', async () => {
    await fireSquadWebhook(
      { ...baseMessage, agent: 'Human' },
      { ...baseSettings, notifyOnHuman: false }
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fire if notifyOnAgent is false for agent message', async () => {
    await fireSquadWebhook(
      { ...baseMessage, agent: 'jules' },
      { ...baseSettings, notifyOnAgent: false }
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fires generic webhook with correct payload', async () => {
    await fireSquadWebhook(baseMessage, baseSettings);

    // Wait a tick for the async fetch to happen
    await new Promise(process.nextTick);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/webhook', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
      }),
      body: expect.any(String),
    }));

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body).toEqual({
      event: 'squad.message',
      message: {
        id: 'msg-1',
        agent: 'jules',
        message: 'test message',
        timestamp: '2023-01-01T00:00:00Z',
      },
      isHuman: false,
    });
  });

  it('includes HMAC signature if secret is provided', async () => {
    const secret = 'supersecret';
    await fireSquadWebhook(baseMessage, { ...baseSettings, secret });

    await new Promise(process.nextTick);

    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers;
    const bodyStr = callArgs[1].body;

    const expectedSignature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

    expect(headers['X-VK-Signature']).toBe(`sha256=${expectedSignature}`);
  });

  it('fires OpenClaw wake call with correct payload', async () => {
    await fireSquadWebhook(
      { ...baseMessage, displayName: 'Jules AI' },
      {
        enabled: true,
        mode: 'openclaw',
        notifyOnHuman: true,
        notifyOnAgent: true,
        openclawGatewayUrl: 'https://gateway.example.com',
        openclawGatewayToken: 'token123',
      }
    );

    await new Promise(process.nextTick);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/tools/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123',
        }),
      })
    );

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body).toEqual({
      tool: 'cron',
      args: {
        action: 'wake',
        text: '🗨️ Squad chat from Jules AI: test message',
        mode: 'now',
      },
    });
  });

  it('validates OpenClaw gateway URL to prevent SSRF', async () => {
    await fireSquadWebhook(baseMessage, {
      enabled: true,
      mode: 'openclaw',
      notifyOnHuman: true,
      notifyOnAgent: true,
      openclawGatewayUrl: 'http://localhost:8080',
      openclawGatewayToken: 'token123',
    });

    await new Promise(process.nextTick);

    // URL validation should fail, so fetch should not be called
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles fetch failures gracefully without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    // Should not throw
    await fireSquadWebhook(baseMessage, baseSettings);

    await new Promise(process.nextTick);

    // Webhook doesn't retry internally, it just fire-and-forgets
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
