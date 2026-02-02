import { memo, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Task, TaskPriority, BlockedCategory } from '@veritas-kanban/shared';
import {
  Check,
  Ban,
  Clock,
  Timer,
  Loader2,
  Paperclip,
  ListChecks,
  ShieldCheck,
  Zap,
  MessageSquare,
  Wrench,
  Link2,
  HelpCircle,
  Play,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useBulkActions } from '@/hooks/useBulkActions';
import { formatDuration } from '@/hooks/useTimeTracking';
import { getTypeIcon, getTypeColor } from '@/hooks/useTaskTypes';
import { getProjectColor, getProjectLabel } from '@/hooks/useProjects';
import { getSprintLabel } from '@/hooks/useSprints';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { useTaskConfig } from '@/contexts/TaskConfigContext';
import { type TaskCardMetrics, formatCompactDuration } from '@/hooks/useBulkTaskMetrics';
import { sanitizeText } from '@/lib/sanitize';

const agentNames: Record<string, string> = {
  'claude-code': 'Claude',
  amp: 'Amp',
  copilot: 'Copilot',
  gemini: 'Gemini',
  veritas: 'Veritas',
};

const blockedCategoryInfo: Record<
  BlockedCategory,
  { label: string; shortLabel: string; icon: React.ElementType }
> = {
  'waiting-on-feedback': {
    label: 'Waiting on Feedback',
    shortLabel: 'Feedback',
    icon: MessageSquare,
  },
  'technical-snag': { label: 'Technical Snag', shortLabel: 'Snag', icon: Wrench },
  prerequisite: { label: 'Prerequisite', shortLabel: 'Prereq', icon: Link2 },
  other: { label: 'Other', shortLabel: 'Other', icon: HelpCircle },
};

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  isDragActive?: boolean;
  onClick?: () => void;
  isSelected?: boolean;
  isBlocked?: boolean;
  blockerTitles?: string[];
  cardMetrics?: TaskCardMetrics;
}

/**
 * Custom comparison for React.memo to prevent unnecessary re-renders.
 * The default shallow comparison fails because parent renders create new
 * object/array/function references for onClick, cardMetrics, blockerTitles,
 * and the task object itself (from React Query refetches).
 */
function areTaskCardPropsEqual(prev: TaskCardProps, next: TaskCardProps): boolean {
  // Simple scalar/boolean props
  if (prev.isDragging !== next.isDragging) return false;
  if (prev.isDragActive !== next.isDragActive) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isBlocked !== next.isBlocked) return false;
  // onClick is intentionally skipped — always a new closure but functionally equivalent

  // Task object — compare fields that affect rendering rather than reference
  const pt = prev.task;
  const nt = next.task;
  if (pt !== nt) {
    if (pt.id !== nt.id) return false;
    if (pt.title !== nt.title) return false;
    if (pt.description !== nt.description) return false;
    if (pt.status !== nt.status) return false;
    if (pt.priority !== nt.priority) return false;
    if (pt.type !== nt.type) return false;
    if (pt.project !== nt.project) return false;
    if (pt.sprint !== nt.sprint) return false;
    if (pt.timeTracking?.totalSeconds !== nt.timeTracking?.totalSeconds) return false;
    if (pt.timeTracking?.isRunning !== nt.timeTracking?.isRunning) return false;
    if (pt.attempt?.status !== nt.attempt?.status) return false;
    if (pt.attempt?.agent !== nt.attempt?.agent) return false;
    if (pt.blockedReason?.category !== nt.blockedReason?.category) return false;
    if (pt.blockedReason?.note !== nt.blockedReason?.note) return false;
    // Subtasks — compare count and completion state
    const pSubs = pt.subtasks || [];
    const nSubs = nt.subtasks || [];
    if (pSubs.length !== nSubs.length) return false;
    for (let i = 0; i < pSubs.length; i++) {
      if (pSubs[i].completed !== nSubs[i].completed) return false;
    }
    // Verification steps — compare count and checked state
    const pVSteps = pt.verificationSteps || [];
    const nVSteps = nt.verificationSteps || [];
    if (pVSteps.length !== nVSteps.length) return false;
    for (let i = 0; i < pVSteps.length; i++) {
      if (pVSteps[i].checked !== nVSteps[i].checked) return false;
    }
    // Attachments — only count matters for the badge
    if ((pt.attachments?.length || 0) !== (nt.attachments?.length || 0)) return false;
  }

  // blockerTitles — compare array values
  const pBlockers = prev.blockerTitles;
  const nBlockers = next.blockerTitles;
  if (pBlockers !== nBlockers) {
    if (!pBlockers || !nBlockers) return false;
    if (pBlockers.length !== nBlockers.length) return false;
    for (let i = 0; i < pBlockers.length; i++) {
      if (pBlockers[i] !== nBlockers[i]) return false;
    }
  }

  // cardMetrics — compare individual scalar fields
  const pm = prev.cardMetrics;
  const nm = next.cardMetrics;
  if (pm !== nm) {
    if (!pm || !nm) return false;
    if (pm.totalRuns !== nm.totalRuns) return false;
    if (pm.successfulRuns !== nm.successfulRuns) return false;
    if (pm.failedRuns !== nm.failedRuns) return false;
    if (pm.lastRunSuccess !== nm.lastRunSuccess) return false;
    if (pm.totalDurationMs !== nm.totalDurationMs) return false;
  }

  return true;
}

const priorityColors: Record<TaskPriority, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-slate-500/20 text-slate-400',
};

export const TaskCard = memo(function TaskCard({
  task,
  isDragging,
  isDragActive,
  onClick,
  isSelected,
  isBlocked,
  blockerTitles,
  cardMetrics,
}: TaskCardProps) {
  const { taskTypes, projects, sprints } = useTaskConfig();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isCurrentlyDragging,
  } = useSortable({
    id: task.id,
  });
  const { isSelecting, toggleSelect, isSelected: isBulkSelected } = useBulkActions();
  const isChecked = isBulkSelected(task.id);
  const { settings: featureSettings } = useFeatureSettings();
  const boardSettings = featureSettings.board;
  const isCompact = boardSettings.cardDensity === 'compact';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => {
    if (isCurrentlyDragging || isDragging) return;
    if (isSelecting) {
      toggleSelect(task.id);
      return;
    }
    onClick?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSelect(task.id);
  };

  const isAgentRunning = task.attempt?.status === 'running';

  // Memoize type info
  const { typeLabel, TypeIconComponent, typeColor } = useMemo(() => {
    const typeConfig = taskTypes.find((t) => t.id === task.type);
    const iconName = typeConfig?.icon || 'Code';
    return {
      typeLabel: typeConfig?.label || task.type,
      TypeIconComponent: getTypeIcon(iconName),
      typeColor: getTypeColor(taskTypes, task.type),
    };
  }, [taskTypes, task.type]);

  // Memoize project info
  const { projectColor, projectLabel } = useMemo(
    () => ({
      projectColor: task.project ? getProjectColor(projects, task.project) : 'bg-muted',
      projectLabel: task.project ? getProjectLabel(projects, task.project) : '',
    }),
    [projects, task.project]
  );

  // Memoize subtask progress
  const { subtaskTotal, subtaskCompleted, allSubtasksDone } = useMemo(() => {
    const subtasks = task.subtasks || [];
    const total = subtasks.length;
    const completed = subtasks.filter((s) => s.completed).length;
    return {
      subtaskTotal: total,
      subtaskCompleted: completed,
      allSubtasksDone: total > 0 && completed === total,
    };
  }, [task.subtasks]);

  // Memoize verification progress
  const { verificationTotal, verificationChecked, allVerificationDone } = useMemo(() => {
    const steps = task.verificationSteps || [];
    const total = steps.length;
    const checked = steps.filter((s) => s.checked).length;
    return {
      verificationTotal: total,
      verificationChecked: checked,
      allVerificationDone: total > 0 && checked === total,
    };
  }, [task.verificationSteps]);

  // Suppress the outer card tooltip entirely during any drag operation
  const suppressCardTooltip = isDragActive || isDragging || isCurrentlyDragging;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={500} open={suppressCardTooltip ? false : undefined}>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role="article"
            tabIndex={0}
            aria-label={`Task: ${task.title}, Priority: ${task.priority}${isBlocked ? ', Blocked' : ''}${isAgentRunning ? ', Agent running' : ''}`}
            className={cn(
              'group bg-card border border-border rounded-md cursor-grab active:cursor-grabbing',
              isCompact ? 'p-2' : 'p-3',
              'hover:border-muted-foreground/50 hover:bg-card/80 transition-all',
              'border-l-2',
              typeColor,
              isDragging && 'opacity-50 shadow-lg rotate-2 scale-105',
              isCurrentlyDragging && 'opacity-50',
              isSelected && 'ring-2 ring-primary border-primary',
              isAgentRunning &&
                'ring-2 ring-blue-500/50 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
            )}
          >
            <span className="sr-only">Status: {task.status}</span>
            <div className="flex items-start gap-2">
              {isSelecting && (
                <button
                  onClick={handleCheckboxClick}
                  aria-label={isChecked ? 'Deselect task' : 'Select task'}
                  className={cn(
                    'h-4 w-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                    isChecked
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/50 hover:border-primary'
                  )}
                >
                  {isChecked && <Check className="h-3 w-3" />}
                </button>
              )}
              <span className="text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true">
                {TypeIconComponent && <TypeIconComponent className="h-3.5 w-3.5" />}
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium leading-tight truncate">{task.title}</h3>
                {!isCompact && task.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {sanitizeText(task.description)}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {/* Agent running indicator */}
              {isAgentRunning && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 flex items-center gap-1 animate-pulse">
                      <span className="sr-only">
                        Agent {agentNames[task.attempt?.agent || ''] || task.attempt?.agent} is
                        actively running on this task
                      </span>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {agentNames[task.attempt?.agent || ''] || 'Agent'} running
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">Agent Active</p>
                    <p className="text-sm">
                      {agentNames[task.attempt?.agent || ''] || task.attempt?.agent} is working on
                      this task
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {isBlocked && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
                      <Ban className="h-3 w-3" />
                      Blocked
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">Blocked by:</p>
                    <ul className="text-sm">
                      {blockerTitles?.map((title, i) => (
                        <li key={i}>• {title}</li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Blocked reason badge (only shown in Blocked column) */}
              {task.status === 'blocked' &&
                task.blockedReason &&
                (() => {
                  const info = blockedCategoryInfo[task.blockedReason.category];
                  const BlockedIcon = info.icon;
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 flex items-center gap-1">
                          <BlockedIcon className="h-3 w-3" />
                          {info.shortLabel}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{info.label}</p>
                        {task.blockedReason.note && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {sanitizeText(task.blockedReason.note)}
                          </p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })()}
              {/* Left side: project, type label, priority — controlled by board settings */}
              {boardSettings.showProjectBadges && task.project && (
                <span className={cn('text-xs px-1.5 py-0.5 rounded', projectColor)}>
                  {projectLabel}
                </span>
              )}
              {boardSettings.showSprintBadges && task.sprint && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {getSprintLabel(sprints, task.sprint)}
                </span>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {typeLabel}
              </span>
              {boardSettings.showPriorityIndicators && (
                <span
                  className={cn(
                    'text-xs px-1.5 py-0.5 rounded capitalize',
                    priorityColors[task.priority]
                  )}
                >
                  {task.priority}
                </span>
              )}
              {/* Attachment indicator */}
              {task.attachments && task.attachments.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1">
                  <Paperclip className="h-3 w-3" />
                  {task.attachments.length}
                </span>
              )}
              {/* Plan indicator removed — planning was agent-internal */}
              {/* Right side: subtask count + time tracking */}
              {subtaskTotal > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ml-auto',
                        allSubtasksDone
                          ? 'bg-green-500/20 text-green-500'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <ListChecks className="h-3 w-3" />
                      {subtaskCompleted}/{subtaskTotal}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">Subtasks</p>
                    <p className="text-sm">
                      {subtaskCompleted} of {subtaskTotal} completed
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Verification progress indicator */}
              {verificationTotal > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded flex items-center gap-1',
                        !subtaskTotal && 'ml-auto',
                        allVerificationDone
                          ? 'bg-green-500/20 text-green-500'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {verificationChecked}/{verificationTotal}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">Done Criteria</p>
                    <p className="text-sm">
                      {verificationChecked} of {verificationTotal} verified
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Time tracking indicator */}
              {(task.timeTracking?.totalSeconds || task.timeTracking?.isRunning) && (
                <span
                  className={cn(
                    'text-xs px-1.5 py-0.5 rounded flex items-center gap-1',
                    !subtaskTotal && !verificationTotal && !cardMetrics && 'ml-auto',
                    task.timeTracking?.isRunning
                      ? 'bg-green-500/20 text-green-500'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {task.timeTracking?.isRunning ? (
                    <Timer className="h-3 w-3 animate-pulse" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                  {formatDuration(task.timeTracking?.totalSeconds || 0)}
                </span>
              )}
              {/* Agent run metrics (for done tasks only) */}
              {cardMetrics && cardMetrics.totalRuns > 0 && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded flex items-center gap-1',
                          !subtaskTotal && !task.timeTracking?.totalSeconds && 'ml-auto',
                          'bg-muted text-muted-foreground'
                        )}
                      >
                        <Play className="h-3 w-3" />
                        {cardMetrics.totalRuns}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-medium">
                        {cardMetrics.totalRuns} run{cardMetrics.totalRuns !== 1 ? 's' : ''}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {cardMetrics.successfulRuns} successful, {cardMetrics.failedRuns} failed
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  {cardMetrics.lastRunSuccess !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            'text-xs px-1 py-0.5 rounded flex items-center',
                            cardMetrics.lastRunSuccess
                              ? 'bg-green-500/20 text-green-500'
                              : 'bg-red-500/20 text-red-500'
                          )}
                        >
                          {cardMetrics.lastRunSuccess ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">
                          Last run: {cardMetrics.lastRunSuccess ? 'Success' : 'Failed'}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {cardMetrics.totalDurationMs > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1 bg-muted text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatCompactDuration(cardMetrics.totalDurationMs)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">Total agent time</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCompactDuration(cardMetrics.totalDurationMs)} across{' '}
                          {cardMetrics.totalRuns} run{cardMetrics.totalRuns !== 1 ? 's' : ''}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium">{task.title}</p>
          {task.description && (
            <p className="text-muted-foreground text-sm mt-1">{sanitizeText(task.description)}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}, areTaskCardPropsEqual);
