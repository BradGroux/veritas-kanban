import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/api/helpers', () => ({
  API_BASE: '/api',
  apiFetch,
}));

import { schedulerApi } from '@/lib/api/scheduler';

describe('scheduler API', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
  });

  it('binds draft and scheduler operations to encoded API routes', async () => {
    const draft = { intent: 'Every weekday', requestId: 'request-1', hints: { timezone: 'UTC' } };

    await schedulerApi.list();
    await schedulerApi.listDrafts();
    await schedulerApi.previewDraft(draft);
    await schedulerApi.saveDraft(draft);
    await schedulerApi.runDue();
    await schedulerApi.runItem('item/one');
    await schedulerApi.pause('item/one');
    await schedulerApi.resume('item/one');
    await schedulerApi.validate('item/one');

    expect(apiFetch.mock.calls).toEqual([
      ['/api/scheduler'],
      ['/api/scheduler/drafts'],
      ['/api/scheduler/drafts/preview', { method: 'POST', body: JSON.stringify(draft) }],
      ['/api/scheduler/drafts', { method: 'POST', body: JSON.stringify(draft) }],
      ['/api/scheduler/due/run', { method: 'POST' }],
      ['/api/scheduler/items/item%2Fone/run', { method: 'POST' }],
      ['/api/scheduler/items/item%2Fone/pause', { method: 'POST' }],
      ['/api/scheduler/items/item%2Fone/resume', { method: 'POST' }],
      ['/api/scheduler/items/item%2Fone/validate', { method: 'POST' }],
    ]);
  });
});
