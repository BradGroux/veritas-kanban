import type { DesktopCommandDispatchRequest } from '@veritas-kanban/shared';
import { isTaskDetailTabId, type TaskDetailNavigationTarget } from './task-detail-tabs';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Consume the task/tab/attempt/event destinations already emitted by search and work products. */
export function desktopTaskLink(request: DesktopCommandDispatchRequest): {
  taskId: string;
  target: TaskDetailNavigationTarget;
} | null {
  const link = request.payload?.deepLink;
  if (request.source !== 'deep-link' || !record(link) || link.resource !== 'task') return null;
  if (
    request.command !== 'open-command-center' ||
    typeof link.resourceId !== 'string' ||
    !link.resourceId.trim()
  )
    throw new Error('The task link does not identify a supported task destination.');
  const params = link.params ?? {};
  if (!record(params)) throw new Error('The task link parameters are invalid.');
  const target: TaskDetailNavigationTarget = {};
  if (params.tab !== undefined) {
    if (typeof params.tab !== 'string' || !isTaskDetailTabId(params.tab))
      throw new Error('The task link requests an unsupported section.');
    target.tab = params.tab;
  }
  for (const [param, field] of [
    ['attempt', 'timelineAttemptId'],
    ['event', 'timelineEventId'],
  ] as const) {
    if (params[param] !== undefined) {
      if (typeof params[param] !== 'string' || !params[param].trim())
        throw new Error('The task link has an invalid timeline target.');
      target[field] = params[param];
    }
  }
  return { taskId: link.resourceId, target };
}
