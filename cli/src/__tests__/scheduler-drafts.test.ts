import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('../utils/api.js', () => ({ api }));

import { registerSchedulerCommands } from '../commands/scheduler.js';

function program(): Command {
  const command = new Command().exitOverride();
  registerSchedulerCommands(command);
  return command;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vk scheduler draft commands', () => {
  it('previews recurring intent with machine-readable API parity', async () => {
    const draft = {
      id: 'automation_123',
      revision: 1,
      status: 'inactive',
      validation: { valid: false, issues: [] },
      objective: { value: 'Every weekday at 9 AM' },
      schedule: { expression: { value: '0 9 * * 1-5' }, timezone: { value: 'UTC' } },
    };
    api.mockResolvedValue(draft);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'scheduler',
      'draft',
      'preview',
      '--intent',
      'Every weekday at 9 AM',
      '--request-id',
      'request-1',
      '--hints',
      '{"timezone":"UTC"}',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/scheduler/drafts/preview', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'Every weekday at 9 AM',
        requestId: 'request-1',
        hints: { timezone: 'UTC' },
      }),
    });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(draft);
    output.mockRestore();
  });

  it('saves, revises, and clones only through inactive draft endpoints', async () => {
    const draft = {
      id: 'automation_123',
      revision: 1,
      status: 'inactive',
      validation: { valid: true, issues: [] },
      objective: { value: 'Daily report' },
      schedule: { expression: { value: '0 9 * * *' }, timezone: { value: 'UTC' } },
    };
    api.mockResolvedValue(draft);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'scheduler',
      'draft',
      'save',
      '--intent',
      'Daily report',
      '--request-id',
      'request-save',
      '--json',
    ]);
    await program().parseAsync([
      'node',
      'vk',
      'scheduler',
      'draft',
      'revise',
      'automation_123',
      '--intent',
      'Daily report',
      '--request-id',
      'request-revise',
      '--json',
    ]);
    await program().parseAsync([
      'node',
      'vk',
      'scheduler',
      'draft',
      'clone',
      'automation_123',
      '--request-id',
      'request-clone',
      '--json',
    ]);
    await program().parseAsync([
      'node',
      'vk',
      'scheduler',
      'draft',
      'delete',
      'automation_123',
      '--confirm',
      'automation_123',
      '--json',
    ]);

    expect(api.mock.calls.map(([url]) => url)).toEqual([
      '/api/scheduler/drafts',
      '/api/scheduler/drafts/automation_123/revisions',
      '/api/scheduler/drafts/automation_123/clone',
      '/api/scheduler/drafts/automation_123?confirm=automation_123',
    ]);
    expect(api.mock.calls.some(([url]) => String(url).includes('/run'))).toBe(false);
    output.mockRestore();
  });

  it('keeps activation bound to the reviewed request revision and approval', async () => {
    const requestRevision = `sha256:${'a'.repeat(64)}`;
    api
      .mockResolvedValueOnce({
        draftId: 'automation_123',
        draftRevision: 2,
        requestRevision,
        evidence: {
          workflowId: 'workflow-1',
          workflowVersion: 4,
          provider: 'openclaw',
          blockers: [],
        },
        schedule: { expiresAt: '2026-12-31T00:00:00.000Z' },
        effectiveRunAccess: { tools: [], integrations: [], externalTargets: [] },
      })
      .mockResolvedValueOnce({
        approvalId: 'runapproval_Automation123456',
        approvalStatus: 'pending',
      });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program().parseAsync([
      'node',
      'vk',
      'scheduler',
      'draft',
      'activation-preview',
      'automation_123',
      '--request-id',
      'activation-1',
      '--revision',
      '2',
      '--json',
    ]);
    await program().parseAsync([
      'node',
      'vk',
      'scheduler',
      'draft',
      'activate',
      'automation_123',
      '--request-id',
      'activation-1',
      '--expected-request-revision',
      requestRevision,
      '--revision',
      '2',
      '--json',
    ]);

    expect(api.mock.calls).toEqual([
      [
        '/api/scheduler/drafts/automation_123/activation-preview',
        {
          method: 'POST',
          body: JSON.stringify({ requestId: 'activation-1', revision: 2 }),
        },
      ],
      [
        '/api/scheduler/drafts/automation_123/activate',
        {
          method: 'POST',
          body: JSON.stringify({
            requestId: 'activation-1',
            expectedRequestRevision: requestRevision,
            revision: 2,
          }),
        },
      ],
    ]);
    output.mockRestore();
  });
});
