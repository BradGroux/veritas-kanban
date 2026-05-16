import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendSquadMessage = vi.fn();

vi.mock('../services/chat-service.js', () => ({
  getChatService: () => ({
    sendSquadMessage,
  }),
}));

describe('hook-service squad chat enforcement', () => {
  beforeEach(async () => {
    vi.resetModules();
    sendSquadMessage.mockReset();
  });

  it('posts lifecycle events to squad chat when enforcement.squadChat is enabled', async () => {
    const { fireHook, setEnforcementSettings, setHooksSettings } =
      await import('../services/hook-service.js');

    setHooksSettings({ enabled: false });
    setEnforcementSettings({
      squadChat: true,
      reviewGate: false,
      closingComments: false,
      autoTelemetry: false,
      autoTimeTracking: false,
      orchestratorDelegation: false,
      orchestratorAgent: '',
    });

    await fireHook(
      'onStarted',
      {
        id: 'task_123',
        title: 'Test task',
        status: 'in-progress',
        project: 'Setup',
        agent: 'codex',
      },
      'todo'
    );

    expect(sendSquadMessage).toHaveBeenCalledWith({
      agent: 'CODEX',
      message: 'Started working on: Test task',
      tags: ['task-lifecycle', 'Setup'],
      system: true,
      event: 'agent.status',
      taskTitle: 'Test task',
    });
  });

  it('does not post lifecycle events to squad chat when enforcement.squadChat is disabled', async () => {
    const { fireHook, setEnforcementSettings, setHooksSettings } =
      await import('../services/hook-service.js');

    setHooksSettings({
      enabled: true,
      onStarted: {
        enabled: true,
      },
    });
    setEnforcementSettings({
      squadChat: false,
      reviewGate: false,
      closingComments: false,
      autoTelemetry: false,
      autoTimeTracking: false,
      orchestratorDelegation: false,
      orchestratorAgent: '',
    });

    await fireHook(
      'onStarted',
      {
        id: 'task_123',
        title: 'Test task',
        status: 'in-progress',
        project: 'Setup',
        agent: 'codex',
      },
      'todo'
    );

    expect(sendSquadMessage).not.toHaveBeenCalled();
  });
});
