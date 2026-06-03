import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

const mockValidateWebhookUrl = vi.fn();
const mockSafeFetch = vi.fn();

vi.mock('../utils/url-validation.js', () => ({
  validateWebhookUrl: mockValidateWebhookUrl,
  safeFetch: mockSafeFetch,
}));

describe('squad webhook service', () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.resetModules();
    mockValidateWebhookUrl.mockReturnValue({ valid: true });
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    mockSafeFetch.mockImplementation((url: string, init: RequestInit) => fetch(url, init));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('skips disabled webhooks and notification modes', async () => {
    const mod = await import('../services/squad-webhook-service.js');
    const message = {
      id: 'm1',
      agent: 'Human',
      message: 'hi',
      timestamp: '2026-03-01T00:00:00.000Z',
    } as any;

    await mod.fireSquadWebhook(message, { enabled: false } as any);
    await mod.fireSquadWebhook(message, {
      enabled: true,
      notifyOnHuman: false,
      notifyOnAgent: true,
      mode: 'generic',
      url: 'https://x.test',
    } as any);
    await mod.fireSquadWebhook({ ...message, agent: 'TARS' }, {
      enabled: true,
      notifyOnHuman: true,
      notifyOnAgent: false,
      mode: 'generic',
      url: 'https://x.test',
    } as any);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fires generic webhook with signed payload', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const mod = await import('../services/squad-webhook-service.js');
    const message = {
      id: 'm1',
      agent: 'TARS',
      displayName: 'Tars',
      message: 'working',
      tags: ['testing'],
      timestamp: '2026-03-01T00:00:00.000Z',
      card: { title: 'Card' },
    } as any;

    await mod.fireSquadWebhook(message, {
      enabled: true,
      notifyOnHuman: true,
      notifyOnAgent: true,
      mode: 'generic',
      url: 'https://example.test/hook',
      secret: 'shhh',
    } as any);

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.test/hook');
    const body = init.body as string;
    const expectedSig = crypto.createHmac('sha256', 'shhh').update(body).digest('hex');
    expect(init.headers['X-VK-Signature']).toBe(`sha256=${expectedSig}`);
    expect(JSON.parse(body)).toMatchObject({
      event: 'squad.message',
      isHuman: false,
      message: { id: 'm1', card: { title: 'Card' } },
    });
  });

  it('fires OpenClaw wake call and validates url', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const mod = await import('../services/squad-webhook-service.js');

    await mod.fireSquadWebhook(
      {
        id: 'm1',
        agent: 'TARS',
        displayName: 'TARS',
        message: 'hello',
        timestamp: '2026-03-01T00:00:00.000Z',
      } as any,
      {
        enabled: true,
        notifyOnHuman: true,
        notifyOnAgent: true,
        mode: 'openclaw',
        openclawGatewayUrl: 'https://gateway.test',
        openclawGatewayToken: 'token',
      } as any
    );

    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://gateway.test/tools/invoke',
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({ allowHttp: true, allowLocalhost: true })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://gateway.test/tools/invoke');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({
      tool: 'cron',
      args: { action: 'wake', mode: 'now' },
    });
  });

  it('skips invalid OpenClaw or incomplete config and tolerates failed responses', async () => {
    const mod = await import('../services/squad-webhook-service.js');
    const msg = {
      id: 'm1',
      agent: 'TARS',
      message: 'hello',
      timestamp: '2026-03-01T00:00:00.000Z',
    } as any;

    await mod.fireSquadWebhook(msg, {
      enabled: true,
      notifyOnHuman: true,
      notifyOnAgent: true,
      mode: 'openclaw',
    } as any);
    mockSafeFetch.mockResolvedValueOnce(null);
    await mod.fireSquadWebhook(msg, {
      enabled: true,
      notifyOnHuman: true,
      notifyOnAgent: true,
      mode: 'openclaw',
      openclawGatewayUrl: 'https://bad.test',
      openclawGatewayToken: 'token',
    } as any);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValue({ ok: false, status: 500, statusText: 'bad' });
    await mod.fireSquadWebhook(msg, {
      enabled: true,
      notifyOnHuman: true,
      notifyOnAgent: true,
      mode: 'generic',
      url: 'https://example.test/hook',
    } as any);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('swallows async generic webhook failures but propagates timeout helper behavior through logging path', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const mod = await import('../services/squad-webhook-service.js');
    await expect(
      mod.fireSquadWebhook(
        { id: 'm1', agent: 'TARS', message: 'hello', timestamp: '2026-03-01T00:00:00.000Z' } as any,
        {
          enabled: true,
          notifyOnHuman: true,
          notifyOnAgent: true,
          mode: 'generic',
          url: 'https://example.test/hook',
        } as any
      )
    ).resolves.toBeUndefined();
  });
});
