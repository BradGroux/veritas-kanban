import { describe, expect, it } from 'vitest';
import type { DesktopCommandDispatchRequest } from '@veritas-kanban/shared';
import { desktopTaskLink } from '@/lib/desktop-task-links';
function request(params: Record<string, unknown> = {}): DesktopCommandDispatchRequest {
  return {
    command: 'open-command-center',
    source: 'deep-link',
    payload: {
      deepLink: { resource: 'task', resourceId: 'task-exact', params },
    },
  };
}
describe('native task navigation targets', () => {
  it.each(['work', 'work-products', 'timeline', 'observations'])(
    'preserves canonical %s sections',
    (tab) => {
      expect(desktopTaskLink(request({ tab }))).toEqual({ taskId: 'task-exact', target: { tab } });
    }
  );
  it('preserves attempt and event targets from existing search links', () => {
    expect(
      desktopTaskLink(request({ tab: 'timeline', attempt: 'attempt-1', event: 'event-1' }))
    ).toEqual({
      taskId: 'task-exact',
      target: { tab: 'timeline', timelineAttemptId: 'attempt-1', timelineEventId: 'event-1' },
    });
  });
  it('uses normal task navigation when no section is supplied', () => {
    expect(desktopTaskLink(request())).toEqual({ taskId: 'task-exact', target: {} });
  });
  it.each([{ tab: 'unsupported' }, { tab: 1 }, { attempt: '' }, { event: false }])(
    'rejects unsupported target %j',
    (params) => {
      expect(() => desktopTaskLink(request(params))).toThrow();
    }
  );
  it('does not reinterpret the ordinary Command Center action', () => {
    expect(desktopTaskLink({ command: 'open-command-center', source: 'menu' })).toBeNull();
  });
  it('rejects malformed task identities and parameter containers', () => {
    expect(() =>
      desktopTaskLink({
        command: 'open-command-center',
        source: 'deep-link',
        payload: { deepLink: { resource: 'task', resourceId: '' } },
      })
    ).toThrow();
    expect(() =>
      desktopTaskLink({
        command: 'open-command-center',
        source: 'deep-link',
        payload: { deepLink: { resource: 'task', resourceId: 'task-exact', params: [] } },
      })
    ).toThrow();
  });
});
