import { describe, expect, it, vi } from 'vitest';

import {
  createNotificationPreview,
  DesktopNotificationCenter,
  type DesktopNotificationAdapter,
} from '../notifications.js';

describe('desktop notifications', () => {
  it('creates privacy-safe previews when private mode is enabled', () => {
    const preview = createNotificationPreview({
      id: 'notice-1',
      kind: 'mention',
      title: 'Brad mentioned you on Secret Task',
      body: 'Sensitive task body',
      target: { type: 'task', id: 'task-1' },
      privacyMode: 'private',
    });

    expect(preview.title).toBe('New mention');
    expect(preview.body).toBe('Open Veritas Kanban to view details.');
    expect(preview.target).toEqual({ type: 'task', id: 'task-1' });
  });

  it('dedupes notifications and emits open actions for durable targets', () => {
    const show = vi.fn((_, onClick: () => void) => onClick());
    const dispatchAction = vi.fn();
    const center = new DesktopNotificationCenter(
      { show } as DesktopNotificationAdapter,
      dispatchAction
    );
    const request = {
      id: 'notice-1',
      kind: 'agent-complete' as const,
      title: 'Agent finished',
      body: 'Done',
      target: { type: 'task' as const, id: 'task-1' },
      dedupeKey: 'task-1:done',
    };

    expect(center.show(request)).not.toBeNull();
    expect(center.show(request)).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledWith({
      notificationId: 'notice-1',
      action: 'open',
      taskId: 'task-1',
    });
  });

  it('supports mark-read style notification actions', () => {
    const dispatchAction = vi.fn();
    const center = new DesktopNotificationCenter(
      { show: vi.fn() } as DesktopNotificationAdapter,
      dispatchAction
    );

    center.markRead('notice-1');

    expect(dispatchAction).toHaveBeenCalledWith({
      notificationId: 'notice-1',
      action: 'dismiss',
    });
  });
});
