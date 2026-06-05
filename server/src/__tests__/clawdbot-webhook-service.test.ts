/**
 * Clawdbot Webhook Service Tests
 *
 * Tests payload formatting, HMAC signing, delivery logic, and retry behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockDeliver = vi.hoisted(() => vi.fn());

vi.mock('../services/outbound-integration-service.js', () => ({
  getOutboundIntegrationService: () => ({
    deliver: mockDeliver,
  }),
}));

import {
  signPayload,
  setWebhookUrl,
  getWebhookUrl,
  deliverWebhook,
  notifyTaskChange,
  notifyChatMessage,
  type WebhookTaskPayload,
  type WebhookChatPayload,
} from '../services/clawdbot-webhook-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDelivery(
  response: { ok: boolean; status?: string; responseStatus?: number; attemptId?: string } = {
    ok: true,
    status: 'success',
    responseStatus: 200,
    attemptId: 'attempt-1',
  }
) {
  mockDeliver.mockResolvedValue({
    status: response.status ?? (response.ok ? 'success' : 'failed'),
    ok: response.ok,
    responseStatus: response.responseStatus ?? (response.ok ? 200 : 500),
    attemptId: response.attemptId ?? 'attempt-1',
  });
  return mockDeliver;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClawdbotWebhookService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDeliver.mockReset();
    // Clear env overrides
    delete process.env.VERITAS_WEBHOOK_URL;
    delete process.env.VERITAS_WEBHOOK_SECRET;
    setWebhookUrl(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  describe('getWebhookUrl()', () => {
    it('returns undefined when nothing is configured', () => {
      expect(getWebhookUrl()).toBeUndefined();
    });

    it('returns settings-based URL when set', () => {
      setWebhookUrl('https://example.com/hook');
      expect(getWebhookUrl()).toBe('https://example.com/hook');
    });

    it('env var takes precedence over settings', () => {
      setWebhookUrl('https://settings.example.com/hook');
      process.env.VERITAS_WEBHOOK_URL = 'https://env.example.com/hook';
      expect(getWebhookUrl()).toBe('https://env.example.com/hook');
    });
  });

  // -------------------------------------------------------------------------
  // Signing
  // -------------------------------------------------------------------------

  describe('signPayload()', () => {
    it('produces a valid HMAC-SHA256 hex digest', () => {
      const sig = signPayload('{"test":true}', 'secret123');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces deterministic output', () => {
      const a = signPayload('hello', 'key');
      const b = signPayload('hello', 'key');
      expect(a).toBe(b);
    });

    it('differs for different secrets', () => {
      const a = signPayload('hello', 'key1');
      const b = signPayload('hello', 'key2');
      expect(a).not.toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  describe('deliverWebhook()', () => {
    const samplePayload: WebhookTaskPayload = {
      event: 'task:created',
      taskId: 'task_123',
      taskTitle: 'Test task',
      timestamp: '2025-01-01T00:00:00.000Z',
    };

    it('does nothing when no webhook URL is configured', async () => {
      mockDelivery();
      await deliverWebhook(samplePayload);
      expect(mockDeliver).not.toHaveBeenCalled();
    });

    it('POSTs JSON to the configured URL', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery();

      await deliverWebhook(samplePayload);

      expect(mockDeliver).toHaveBeenCalledOnce();
      const [endpoint, request] = mockDeliver.mock.calls[0];
      expect(endpoint.url).toBe('https://hook.test/endpoint');
      expect(endpoint.type).toBe('broadcast-webhook');
      expect(request.method).toBe('POST');
      expect(request.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(request.body);
      expect(body.event).toBe('task:created');
      expect(body.taskId).toBe('task_123');
    });

    it('includes X-Webhook-Signature when secret is set', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      process.env.VERITAS_WEBHOOK_SECRET = 'my-secret';
      mockDelivery();

      await deliverWebhook(samplePayload);

      const [, request] = mockDeliver.mock.calls[0];
      expect(request.headers['X-Webhook-Signature']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does NOT include X-Webhook-Signature when no secret', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery();

      await deliverWebhook(samplePayload);

      const [, request] = mockDeliver.mock.calls[0];
      expect(request.headers['X-Webhook-Signature']).toBeUndefined();
    });

    it('retries once after 2 s on failure', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery({ ok: false, status: 'failed', responseStatus: 500 });

      await deliverWebhook(samplePayload);

      // First call already happened
      expect(mockDeliver).toHaveBeenCalledOnce();

      // Advance timers to trigger the retry
      await vi.advanceTimersByTimeAsync(2_000);

      expect(mockDeliver).toHaveBeenCalledTimes(2);
    });

    it('retries once on fetch error (network failure)', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDeliver.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({
        status: 'success',
        ok: true,
        responseStatus: 200,
        attemptId: 'attempt-2',
      });

      await deliverWebhook(samplePayload);

      expect(mockDeliver).toHaveBeenCalledOnce();

      // Advance timers to trigger the retry
      await vi.advanceTimersByTimeAsync(2_000);

      expect(mockDeliver).toHaveBeenCalledTimes(2);
    });

    it('does not retry when outbound URL policy blocks the host', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery({ ok: false, status: 'blocked', attemptId: 'blocked-1' });

      await deliverWebhook(samplePayload);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(mockDeliver).toHaveBeenCalledOnce();
    });

    it('does NOT retry on success', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery({ ok: true });

      await deliverWebhook(samplePayload);

      expect(mockDeliver).toHaveBeenCalledOnce();

      // Advance timers — no retry should fire
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockDeliver).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Payload formatting helpers
  // -------------------------------------------------------------------------

  describe('notifyTaskChange()', () => {
    it('formats a task payload and calls deliverWebhook', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery();

      notifyTaskChange('created', 'task_abc', {
        title: 'My Task',
        status: 'in-progress',
        previousStatus: 'todo',
        assignee: 'agent',
        project: 'proj_1',
      });

      // Allow the promise to resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(mockDeliver).toHaveBeenCalledOnce();
      const body = JSON.parse(mockDeliver.mock.calls[0][1].body);
      expect(body).toMatchObject({
        event: 'task:created',
        taskId: 'task_abc',
        taskTitle: 'My Task',
        status: 'in-progress',
        previousStatus: 'todo',
        assignee: 'agent',
        project: 'proj_1',
      });
      expect(body.timestamp).toBeDefined();
    });

    it('works without optional context', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery();

      notifyTaskChange('deleted', 'task_xyz');

      await vi.advanceTimersByTimeAsync(0);

      expect(mockDeliver).toHaveBeenCalledOnce();
      const body = JSON.parse(mockDeliver.mock.calls[0][1].body);
      expect(body.event).toBe('task:deleted');
      expect(body.taskId).toBe('task_xyz');
    });
  });

  describe('notifyChatMessage()', () => {
    it('formats a chat payload and calls deliverWebhook', async () => {
      setWebhookUrl('https://hook.test/endpoint');
      mockDelivery();

      notifyChatMessage('session_1', 'chat:message', 'Hello world');

      await vi.advanceTimersByTimeAsync(0);

      expect(mockDeliver).toHaveBeenCalledOnce();
      const body: WebhookChatPayload = JSON.parse(mockDeliver.mock.calls[0][1].body);
      expect(body).toMatchObject({
        event: 'chat:message',
        chatSessionId: 'session_1',
        message: 'Hello world',
      });
      expect(body.timestamp).toBeDefined();
    });
  });
});
