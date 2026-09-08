import type { Task } from '../types/task.types.js';
import { evaluateTaskReadiness, type TaskReadinessSummary } from './task-readiness.js';

/** Card projection only. Never place this in the full-task/detail query cache. */
export interface BoardTask extends Task {
  boardSummary: {
    subtaskTotal: number;
    subtaskCompleted: number;
    verificationTotal: number;
    verificationChecked: number;
    attachmentCount: number;
    deliverableCount: number;
    awaitingReview: boolean;
    attempt?: Pick<NonNullable<Task['attempt']>, 'status' | 'agent'>;
    checkpoint?: Pick<NonNullable<Task['checkpoint']>, 'step' | 'resumeCount'>;
    readiness:
      | (Pick<TaskReadinessSummary, 'ready' | 'percent'> & {
          missingRequired: Array<{ label: string }>;
        })
      | null;
  };
}

/** Large descriptions, run transcripts, checklist text and artifact bodies stay in detail. */
export function toBoardTask(task: Task): BoardTask {
  const readiness = task.type === 'code' ? evaluateTaskReadiness(task, { isCodeTask: true }) : null;
  return {
    id: task.id,
    title: task.title,
    description: task.description.slice(0, 400),
    type: task.type,
    status: task.status,
    priority: task.priority,
    project: task.project,
    sprint: task.sprint,
    agent: task.agent,
    created: task.created,
    updated: task.updated,
    revision: task.revision,
    position: task.position,
    boardRank: task.boardRank,
    blockedBy: task.blockedBy,
    dependencies: task.dependencies,
    blockedReason: task.blockedReason
      ? { ...task.blockedReason, note: task.blockedReason.note?.slice(0, 400) }
      : undefined,
    timeTracking: task.timeTracking
      ? {
          totalSeconds: task.timeTracking.totalSeconds,
          isRunning: task.timeTracking.isRunning,
          entries: [],
        }
      : undefined,
    boardSummary: {
      subtaskTotal: task.subtasks?.length ?? 0,
      subtaskCompleted: task.subtasks?.filter((item) => item.completed).length ?? 0,
      verificationTotal: task.verificationSteps?.length ?? 0,
      verificationChecked: task.verificationSteps?.filter((item) => item.checked).length ?? 0,
      attachmentCount: task.attachments?.length ?? 0,
      deliverableCount: task.deliverables?.length ?? 0,
      awaitingReview: (task.reviewComments?.length ?? 0) > 0 && !task.review?.decision,
      attempt: task.attempt
        ? { status: task.attempt.status, agent: task.attempt.agent }
        : undefined,
      checkpoint: task.checkpoint
        ? { step: task.checkpoint.step, resumeCount: task.checkpoint.resumeCount }
        : undefined,
      readiness: readiness
        ? {
            ready: readiness.ready,
            percent: readiness.percent,
            missingRequired: readiness.missingRequired.map((check) => ({ label: check.label })),
          }
        : null,
    },
  };
}
