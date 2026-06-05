import { lazy, type ReactNode } from 'react';
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  ClipboardCheck,
  Eye,
  FileDiff,
  Files,
  GitBranch,
  History,
  NotebookPen,
  Paperclip,
  type LucideIcon,
} from 'lucide-react';
import type { ObservationType, ReviewComment, ReviewState, Task } from '@veritas-kanban/shared';
import {
  getAvailableTaskDetailTabMetadata,
  getFallbackTaskDetailTabId,
  isTaskDetailTabAvailable,
  isTaskDetailTabId,
  TASK_DETAIL_TAB_METADATA,
  type AvailableTaskDetailTabMetadata,
  type TaskDetailAvailabilityContext,
  type TaskDetailTabIcon,
  type TaskDetailTabId,
  type TaskDetailTabMetadata,
} from '@/lib/task-detail-tabs';
import { TaskDetailsTab } from './detail/TaskDetailsTab';
import { TaskWorkView } from './TaskWorkView';

const AgentPanel = lazy(() => import('./AgentPanel').then((mod) => ({ default: mod.AgentPanel })));
const AgentRunTimelinePanel = lazy(() =>
  import('./AgentRunTimelinePanel').then((mod) => ({ default: mod.AgentRunTimelinePanel }))
);
const AttachmentsSection = lazy(() =>
  import('./AttachmentsSection').then((mod) => ({ default: mod.AttachmentsSection }))
);
const DiffViewer = lazy(() => import('./DiffViewer').then((mod) => ({ default: mod.DiffViewer })));
const EvidenceTimelinePanel = lazy(() =>
  import('@/components/evidence/EvidenceTimelinePanel').then((mod) => ({
    default: mod.EvidenceTimelinePanel,
  }))
);
const GitSection = lazy(() => import('./GitSection').then((mod) => ({ default: mod.GitSection })));
const ObservationsSection = lazy(() =>
  import('./ObservationsSection').then((mod) => ({ default: mod.ObservationsSection }))
);
const ProgressTab = lazy(() =>
  import('./detail/ProgressTab').then((mod) => ({ default: mod.ProgressTab }))
);
const ReviewPanel = lazy(() =>
  import('./ReviewPanel').then((mod) => ({ default: mod.ReviewPanel }))
);
const TaskMetricsPanel = lazy(() =>
  import('./TaskMetricsPanel').then((mod) => ({ default: mod.TaskMetricsPanel }))
);
const WorkProductsSection = lazy(() =>
  import('./WorkProductsSection').then((mod) => ({ default: mod.WorkProductsSection }))
);

export type {
  TaskDetailAvailabilityContext,
  TaskDetailNavigationTarget,
  TaskDetailTabId,
} from '@/lib/task-detail-tabs';
export { getFallbackTaskDetailTabId, isTaskDetailTabAvailable, isTaskDetailTabId };

export interface TaskDetailObservationInput {
  type: ObservationType;
  content: string;
  score: number;
  agent?: string;
}

export interface TaskDetailRenderContext extends TaskDetailAvailabilityContext {
  task: Task;
  readOnly: boolean;
  timelineAttemptId: string | null;
  timelineEventId: string | null;
  updateField: <K extends keyof Task>(field: K, value: Task[K]) => void;
  onClose: () => void;
  onRestore?: (taskId: string) => void;
  setActiveTab: (tab: TaskDetailTabId) => void;
  openTaskChat: () => void;
  openWorkflow: () => void;
  setTimelineAttemptId: (attemptId: string | null) => void;
  addObservation: (data: TaskDetailObservationInput) => Promise<void>;
  deleteObservation: (observationId: string) => Promise<void>;
}

export interface TaskDetailTabDefinition extends TaskDetailTabMetadata {
  Icon?: LucideIcon;
  render: (context: TaskDetailRenderContext) => ReactNode;
}

export type AvailableTaskDetailTab = TaskDetailTabDefinition &
  Pick<AvailableTaskDetailTabMetadata, 'disabled'>;

const TAB_ICONS: Record<TaskDetailTabIcon, LucideIcon> = {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  ClipboardCheck,
  Eye,
  FileDiff,
  Files,
  GitBranch,
  History,
  NotebookPen,
  Paperclip,
};

const TAB_RENDERERS: Record<TaskDetailTabId, (context: TaskDetailRenderContext) => ReactNode> = {
  work: ({ task, isCodeTask, readOnly, setActiveTab, openTaskChat, openWorkflow }) => (
    <TaskWorkView
      task={task}
      isCodeTask={isCodeTask}
      readOnly={readOnly}
      onOpenTab={setActiveTab}
      onOpenChat={openTaskChat}
      onOpenWorkflow={openWorkflow}
    />
  ),
  details: ({ task, updateField, onClose, readOnly, onRestore }) => (
    <TaskDetailsTab
      task={task}
      onUpdate={updateField}
      onClose={onClose}
      readOnly={readOnly}
      onRestore={onRestore}
    />
  ),
  progress: ({ task }) => <ProgressTab task={task} />,
  'work-products': ({ task }) => <WorkProductsSection taskId={task.id} />,
  observations: ({ task, addObservation, deleteObservation }) => (
    <ObservationsSection
      task={task}
      onAddObservation={addObservation}
      onDeleteObservation={deleteObservation}
    />
  ),
  attachments: ({ task }) => <AttachmentsSection task={task} />,
  git: ({ task, updateField }) => (
    <GitSection task={task} onGitChange={(git) => updateField('git', git as Task['git'])} />
  ),
  agent: ({ task, setTimelineAttemptId, setActiveTab }) => (
    <AgentPanel
      task={task}
      onOpenTimeline={(attemptId) => {
        setTimelineAttemptId(attemptId ?? null);
        setActiveTab('timeline');
      }}
    />
  ),
  timeline: ({ task, timelineAttemptId, timelineEventId, setActiveTab, openWorkflow }) => (
    <AgentRunTimelinePanel
      task={task}
      initialAttemptId={timelineAttemptId}
      initialEventId={timelineEventId}
      onOpenTab={setActiveTab}
      onOpenWorkflow={openWorkflow}
    />
  ),
  evidence: ({ task }) => <EvidenceTimelinePanel taskId={task.id} />,
  changes: ({ task, hasWorktree, updateField }) => {
    if (!hasWorktree) return null;
    return (
      <DiffViewer
        task={task}
        onAddComment={(comment: ReviewComment) => {
          const newComments = [...(task.reviewComments || []), comment];
          updateField('reviewComments', newComments);
        }}
        onRemoveComment={(commentId: string) => {
          const newComments = (task.reviewComments || []).filter(
            (comment) => comment.id !== commentId
          );
          updateField('reviewComments', newComments.length > 0 ? newComments : undefined);
        }}
      />
    );
  },
  review: ({ task, updateField, onClose }) => (
    <ReviewPanel
      task={task}
      onReview={(review: ReviewState) => {
        updateField('review', Object.keys(review).length > 0 ? review : undefined);
      }}
      onMergeComplete={onClose}
    />
  ),
  metrics: ({ task }) => <TaskMetricsPanel task={task} />,
};

export const TASK_DETAIL_TABS: readonly TaskDetailTabDefinition[] = TASK_DETAIL_TAB_METADATA.map(
  (tab) => ({
    ...tab,
    Icon: tab.icon ? TAB_ICONS[tab.icon] : undefined,
    render: TAB_RENDERERS[tab.id],
  })
);

export function getAvailableTaskDetailTabs(
  context: TaskDetailAvailabilityContext
): AvailableTaskDetailTab[] {
  const tabsById = new Map(TASK_DETAIL_TABS.map((tab) => [tab.id, tab]));
  return getAvailableTaskDetailTabMetadata(context).map((tab) => ({
    ...getTaskDetailTabDefinition(tabsById, tab.id),
    disabled: tab.disabled,
  }));
}

function getTaskDetailTabDefinition(
  tabsById: ReadonlyMap<TaskDetailTabId, TaskDetailTabDefinition>,
  tabId: TaskDetailTabId
): TaskDetailTabDefinition {
  const definition = tabsById.get(tabId);
  if (!definition) {
    throw new Error(`Task detail tab ${tabId} is missing a renderer.`);
  }
  return definition;
}
