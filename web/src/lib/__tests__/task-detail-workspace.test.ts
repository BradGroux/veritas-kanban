import { describe, expect, it } from 'vitest';

import {
  getAvailableTaskDetailTabMetadata,
  getAvailableTaskWorkspaceModeMetadata,
  getTaskWorkspaceDestination,
  resolveTaskDetailNavigationTab,
  TASK_DETAIL_TAB_METADATA,
  TASK_WORKSPACE_MODE_METADATA,
  type TaskDetailTabId,
} from '@/lib/task-detail-tabs';

describe('task workspace navigation', () => {
  it('maps every legacy task-detail tab to one reviewed mode and section', () => {
    const expected: Record<TaskDetailTabId, string> = {
      work: 'overview',
      details: 'plan',
      progress: 'plan',
      dependencies: 'plan',
      'work-products': 'results',
      observations: 'plan',
      attachments: 'plan',
      workflow: 'run',
      access: 'run',
      git: 'run',
      agent: 'run',
      verification: 'results',
      timeline: 'history',
      evidence: 'results',
      changes: 'results',
      review: 'results',
      metrics: 'history',
    };

    for (const tab of TASK_DETAIL_TAB_METADATA) {
      expect(getTaskWorkspaceDestination(tab.id)).toEqual({
        mode: expected[tab.id],
        section: tab.id,
      });
    }

    expect(TASK_WORKSPACE_MODE_METADATA.map((mode) => mode.id)).toEqual([
      'overview',
      'plan',
      'run',
      'results',
      'history',
    ]);
  });

  it('keeps unavailable task surfaces out of mode selection', () => {
    const tabs = getAvailableTaskDetailTabMetadata({
      isCodeTask: false,
      hasWorktree: false,
      attachmentsEnabled: false,
      dependenciesEnabled: false,
    });
    const modes = getAvailableTaskWorkspaceModeMetadata(tabs);

    expect(tabs.some((tab) => tab.id === 'dependencies')).toBe(false);
    expect(tabs.some((tab) => tab.id === 'attachments')).toBe(false);
    expect(modes.find((mode) => mode.id === 'run')?.disabled).toBe(true);
    expect(modes.filter((mode) => !mode.disabled).map((mode) => mode.id)).toEqual([
      'overview',
      'plan',
      'results',
      'history',
    ]);
  });

  it('resolves legacy and versioned deep links through the same availability rules', () => {
    const tabs = getAvailableTaskDetailTabMetadata({
      isCodeTask: true,
      hasWorktree: false,
      attachmentsEnabled: true,
      dependenciesEnabled: true,
    });

    expect(resolveTaskDetailNavigationTab({ tab: 'timeline' }, tabs)).toBe('timeline');
    for (const section of ['agent', 'workflow', 'access', 'git'] as const) {
      expect(resolveTaskDetailNavigationTab({ tab: section }, tabs)).toBe(section);
      expect(
        resolveTaskDetailNavigationTab({ workspace: { version: 1, mode: 'run', section } }, tabs)
      ).toBe(section);
    }
    for (const section of ['timeline', 'metrics'] as const) {
      expect(resolveTaskDetailNavigationTab({ tab: section }, tabs)).toBe(section);
      expect(
        resolveTaskDetailNavigationTab(
          { workspace: { version: 1, mode: 'history', section } },
          tabs
        )
      ).toBe(section);
    }
    const tabsWithWorktree = getAvailableTaskDetailTabMetadata({
      isCodeTask: true,
      hasWorktree: true,
      attachmentsEnabled: true,
      dependenciesEnabled: true,
    });
    for (const section of [
      'work-products',
      'changes',
      'review',
      'verification',
      'evidence',
    ] as const) {
      expect(resolveTaskDetailNavigationTab({ tab: section }, tabsWithWorktree)).toBe(section);
      expect(
        resolveTaskDetailNavigationTab(
          { workspace: { version: 1, mode: 'results', section } },
          tabsWithWorktree
        )
      ).toBe(section);
    }
    for (const section of [
      'details',
      'progress',
      'observations',
      'dependencies',
      'attachments',
    ] as const) {
      expect(resolveTaskDetailNavigationTab({ tab: section }, tabs)).toBe(section);
      expect(
        resolveTaskDetailNavigationTab({ workspace: { version: 1, mode: 'plan', section } }, tabs)
      ).toBe(section);
    }
    expect(
      resolveTaskDetailNavigationTab(
        { workspace: { version: 1, mode: 'results', section: 'evidence' } },
        tabs
      )
    ).toBe('evidence');
    expect(
      resolveTaskDetailNavigationTab(
        { workspace: { version: 1, mode: 'results', section: 'changes' } },
        tabs
      )
    ).toBe('work-products');
    expect(resolveTaskDetailNavigationTab({ tab: 'changes' }, tabs)).toBeNull();
  });
});
