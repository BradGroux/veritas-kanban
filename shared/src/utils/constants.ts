/**
 * Shared constants used across the application
 */

/**
 * Priority level labels
 */
export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/**
 * Task status labels
 */
export const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  'in-progress': 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

/**
 * Task type labels
 */
export const TYPE_LABELS: Record<string, string> = {
  feature: 'Feature',
  bug: 'Bug',
  refactor: 'Refactor',
  docs: 'Documentation',
  test: 'Test',
  chore: 'Chore',
};
