import { Router } from 'express';
import { getTaskService } from '../services/task-service.js';
import { createLogger } from '../lib/logger.js';
import type { Task } from '@veritas-kanban/shared';

const router = Router();
const log = createLogger('lessons');

/**
 * Lesson entry with task context
 */
export interface LessonEntry {
  taskId: string;
  taskTitle: string;
  project?: string;
  sprint?: string;
  lessonsLearned: string;
  lessonTags: string[];
  completedAt: string; // Task updated timestamp (when marked done)
}

/**
 * GET /api/lessons
 *
 * Returns lessons learned across all completed tasks.
 *
 * Query params:
 * - project: Filter by project
 * - sprint: Filter by sprint
 * - tag: Filter by tag (can be repeated)
 * - search: Full-text search in lessons content
 * - limit: Max results (default 50)
 * - offset: Pagination offset (default 0)
 */
router.get('/', async (req, res, next) => {
  try {
    const taskService = getTaskService();
    const allTasks = await taskService.listTasks();

    // Also include archived tasks for historical lessons
    const archivedTasks = await taskService.listArchivedTasks();
    const combinedTasks = [...allTasks, ...archivedTasks];

    // Filter to tasks with lessons learned
    let tasksWithLessons = combinedTasks.filter(
      (t): t is Task & { lessonsLearned: string } =>
        !!t.lessonsLearned && t.lessonsLearned.trim().length > 0
    );

    // Apply filters
    const { project, sprint, tag, search, limit = '50', offset = '0' } = req.query;

    if (project && typeof project === 'string') {
      tasksWithLessons = tasksWithLessons.filter((t) => t.project === project);
    }

    if (sprint && typeof sprint === 'string') {
      tasksWithLessons = tasksWithLessons.filter((t) => t.sprint === sprint);
    }

    // Tag filter - supports multiple tags (AND logic)
    const tags = Array.isArray(tag) ? tag : tag ? [tag] : [];
    if (tags.length > 0) {
      tasksWithLessons = tasksWithLessons.filter((t) => {
        const taskTags = t.lessonTags || [];
        return tags.every((filterTag) =>
          taskTags.some((tt) => tt.toLowerCase() === String(filterTag).toLowerCase())
        );
      });
    }

    // Search filter
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      tasksWithLessons = tasksWithLessons.filter(
        (t) =>
          t.lessonsLearned.toLowerCase().includes(searchLower) ||
          t.title.toLowerCase().includes(searchLower) ||
          (t.lessonTags || []).some((tag) => tag.toLowerCase().includes(searchLower))
      );
    }

    // Sort by updated date (most recent first)
    tasksWithLessons.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

    // Pagination
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
    const offsetNum = parseInt(offset as string, 10) || 0;
    const total = tasksWithLessons.length;
    const paginatedTasks = tasksWithLessons.slice(offsetNum, offsetNum + limitNum);

    // Map to lesson entries
    const lessons: LessonEntry[] = paginatedTasks.map((t) => ({
      taskId: t.id,
      taskTitle: t.title,
      project: t.project,
      sprint: t.sprint,
      lessonsLearned: t.lessonsLearned,
      lessonTags: t.lessonTags || [],
      completedAt: t.updated,
    }));

    log.debug({ total, returned: lessons.length }, 'Fetched lessons');

    res.json({
      data: lessons,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/lessons/tags
 *
 * Returns all unique lesson tags with counts
 */
router.get('/tags', async (req, res, next) => {
  try {
    const taskService = getTaskService();
    const allTasks = await taskService.listTasks();
    const archivedTasks = await taskService.listArchivedTasks();
    const combinedTasks = [...allTasks, ...archivedTasks];

    // Collect all tags with counts
    const tagCounts = new Map<string, number>();

    for (const task of combinedTasks) {
      if (task.lessonTags && task.lessonTags.length > 0) {
        for (const tag of task.lessonTags) {
          const normalizedTag = tag.toLowerCase();
          tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) || 0) + 1);
        }
      }
    }

    // Convert to sorted array
    const tags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ data: tags });
  } catch (err) {
    next(err);
  }
});

export default router;
