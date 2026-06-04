/**
 * Changes Service
 * Efficient polling endpoint for agents to get everything that changed since last check.
 */

import { getTaskService } from './task-service.js';
import { activityService } from './activity-service.js';
import type { ChangesResponse, ChangesQueryParams, CommentChange } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('changes-service');

export class ChangesService {
  /**
   * Get all changes since a given timestamp.
   * Filters by requested types and returns either full objects or summaries.
   */
  async getChangesSince(params: ChangesQueryParams): Promise<ChangesResponse> {
    const sinceDate = new Date(params.since);
    const untilDate = new Date();

    // Parse requested types (default: all)
    const requestedTypes = params.types
      ? params.types.split(',').map((t) => t.trim())
      : ['tasks', 'comments', 'activity', 'broadcasts'];

    const response: ChangesResponse = {
      since: params.since,
      until: untilDate.toISOString(),
      changes: {
        tasks: { created: [], updated: [] },
        comments: [],
        activity: [],
        broadcasts: [],
      },
      summary: {
        totalChanges: 0,
        breakdown: {},
      },
    };

    // Fetch tasks changes if requested
    if (requestedTypes.includes('tasks')) {
      const taskService = getTaskService();
      const allTasks = await taskService.listTasks();

      // Filter tasks by timestamps
      const createdTasks = allTasks.filter(
        (task) => new Date(task.created).getTime() >= sinceDate.getTime()
      );

      const updatedTasks = allTasks.filter(
        (task) =>
          new Date(task.updated).getTime() >= sinceDate.getTime() &&
          new Date(task.created).getTime() < sinceDate.getTime()
      );

      response.changes.tasks = {
        created: createdTasks,
        updated: updatedTasks,
      };

      response.summary.breakdown['tasks.created'] = createdTasks.length;
      response.summary.breakdown['tasks.updated'] = updatedTasks.length;
    }

    // Fetch comments changes if requested
    // Note: Comments are stored in task.comments array, so we scan all tasks
    if (requestedTypes.includes('comments')) {
      const taskService = getTaskService();
      const allTasks = await taskService.listTasks();

      const commentChanges: CommentChange[] = [];

      for (const task of allTasks) {
        if (task.comments && task.comments.length > 0) {
          const recentComments = task.comments.filter(
            (comment: { id: string; author: string; text: string; timestamp: string }) =>
              new Date(comment.timestamp).getTime() >= sinceDate.getTime()
          );

          for (const comment of recentComments) {
            commentChanges.push({
              taskId: task.id,
              comment,
            });
          }
        }
      }

      response.changes.comments = commentChanges;
      response.summary.breakdown['comments'] = commentChanges.length;
    }

    // Fetch activity changes if requested
    if (requestedTypes.includes('activity')) {
      const activities = await activityService.getActivities(5000, {
        since: params.since,
        until: untilDate.toISOString(),
      });

      response.changes.activity = activities;
      response.summary.breakdown['activity'] = activities.length;
    }

    // Fetch broadcast messages if requested
    // Note: Broadcasts are ephemeral WebSocket messages, not persisted.
    // We return an empty array here but keep the structure for future enhancement.
    if (requestedTypes.includes('broadcasts')) {
      // Broadcast service doesn't persist messages — they're ephemeral WebSocket events
      // We could implement a short-lived cache here if needed
      response.changes.broadcasts = [];
      response.summary.breakdown['broadcasts'] = 0;
    }

    // Calculate total changes
    response.summary.totalChanges = Object.values(response.summary.breakdown).reduce(
      (sum: number, count: number) => sum + count,
      0
    );

    log.debug(
      {
        since: params.since,
        until: response.until,
        totalChanges: response.summary.totalChanges,
        breakdown: response.summary.breakdown,
      },
      'Changes polled'
    );

    return response;
  }
}

// Singleton instance
let changesServiceInstance: ChangesService | null = null;

export function getChangesService(): ChangesService {
  if (!changesServiceInstance) {
    changesServiceInstance = new ChangesService();
  }
  return changesServiceInstance;
}
