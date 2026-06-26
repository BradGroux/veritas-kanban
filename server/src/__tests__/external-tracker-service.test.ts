import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import {
  ExternalTrackerService,
  type ExternalTrackerTaskService,
} from '../services/external-tracker-service.js';
import type { ActivityService } from '../services/activity-service.js';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_20260626_tracker',
    title: 'Add tracker introspection',
    description: 'Create a configurable external tracker mapping.',
    type: 'feature',
    status: 'todo',
    priority: 'high',
    created: '2026-06-26T12:00:00.000Z',
    updated: '2026-06-26T12:00:00.000Z',
    ...overrides,
  } as Task;
}

function createHarness(task: Task = createTask()) {
  const audit = vi.fn().mockResolvedValue(undefined);
  const updateTask = vi.fn().mockResolvedValue(task);
  const taskService: ExternalTrackerTaskService = {
    getTask: vi.fn().mockResolvedValue(task),
    updateTask,
  };
  const activity = {
    logActivity: vi.fn().mockResolvedValue({ id: 'activity_1' }),
  } as unknown as ActivityService;

  return {
    audit,
    activity,
    taskService,
    updateTask,
    service: new ExternalTrackerService({
      persist: false,
      audit,
      taskService,
      activity,
    }),
  };
}

describe('ExternalTrackerService', () => {
  it('introspects a normalized mock tracker schema and default mapping profile', async () => {
    const { service } = createHarness();

    const schema = await service.introspect(
      { provider: 'mock', project: 'Veritas Kanban' },
      'brad'
    );
    const profiles = await service.listProfiles();

    expect(schema.workItemTypes.map((item) => item.id)).toEqual(['Bug', 'Feature', 'Task']);
    expect(schema.fields.some((field) => field.id === 'System.AreaPath' && field.required)).toBe(
      true
    );
    expect(schema.areaPaths[0].path).toBe('Veritas Kanban\\Platform');
    expect(profiles[0]).toMatchObject({
      id: 'default-mock-profile',
      defaultWorkItemType: 'Task',
      backlinkFieldId: 'Custom.VeritasBacklink',
    });
  });

  it('rejects mapping profiles with invalid required planning paths', async () => {
    const { service } = createHarness();
    const [profile] = await service.listProfiles();

    await expect(
      service.saveProfile(
        {
          ...profile,
          defaultAreaPath: 'Veritas Kanban\\Missing',
        },
        'brad'
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('catches invalid mapped values during dry-run before create', async () => {
    const task = createTask({ priority: 'critical' });
    const { service } = createHarness(task);
    const [profile] = await service.listProfiles();
    await service.saveProfile(
      {
        ...profile,
        valueMappings: {
          ...profile.valueMappings,
          priority: { ...profile.valueMappings?.priority, critical: 9 },
        },
      },
      'brad'
    );

    const result = await service.dryRunCreate({ profileId: profile.id, taskId: task.id }, 'brad');

    expect(result.externalWrite).toBe(false);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors[0]).toMatchObject({
      code: 'INVALID_FIELD_VALUE',
      fieldId: 'Microsoft.VSTS.Common.Priority',
    });
  });

  it('creates an approved mock work item and records a Veritas backlink on the task', async () => {
    const task = createTask();
    const { service, updateTask, activity } = createHarness(task);
    const [profile] = await service.listProfiles();

    const result = await service.createWorkItem({
      profileId: profile.id,
      taskId: task.id,
      approvedBy: 'brad',
    });

    expect(result.externalWrite).toBe(true);
    expect(result.link.externalId).toMatch(/^MOCK-/);
    expect(result.payload.fields['Custom.VeritasBacklink']).toBe(
      'veritas-kanban://tasks/task_20260626_tracker'
    );
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        externalWorkItems: [
          expect.objectContaining({
            provider: 'mock',
            profileId: profile.id,
            externalUrl: expect.stringContaining('/work-items/MOCK-'),
          }),
        ],
      })
    );
    expect(activity.logActivity).toHaveBeenCalledWith(
      'agent_event',
      task.id,
      task.title,
      expect.objectContaining({
        event: 'external_tracker.work_item_created',
        externalId: result.link.externalId,
      }),
      undefined,
      'brad'
    );
  });
});
