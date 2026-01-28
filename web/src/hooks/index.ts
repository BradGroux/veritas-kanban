/**
 * Hooks barrel export
 * Import hooks from '@/hooks' for cleaner imports
 */

export * from './useActivity';
export * from './useAgent';
export * from './useBoardDragDrop';
export * from './useSortableList';
export * from './useAttachments';
export * from './useBulkActions';
export * from './useConfig';
export * from './useCreateTaskForm';
export * from './usePolling';
export * from './useConflicts';
export * from './useDebouncedSave';
export * from './useDiff';
export * from './useFeatureSettings';
export * from './useGitHub';
// Real-time WebSocket-based global agent status
export {
  useRealtimeAgentStatus,
  useGlobalAgentStatusRT,
  type AgentStatusData,
  type AgentStatusState,
  type SubAgent,
} from './useAgentStatus';
// Polling-based global agent status (legacy, prefer useRealtimeAgentStatus)
export * from './useGlobalAgentStatus';
export * from './useKeyboard';
export * from './useManagedList';
export * from './useMetrics';
export * from './usePreview';
export * from './useProjects';
export * from './useSprints';
export * from './useTaskSync';
export * from './useTaskTypes';
export * from './useTasks';
export * from './useTemplateForm';
export * from './useTemplates';
// Note: useTimeTracking also exports formatDuration - import directly to avoid conflict with useMetrics
export {
  useTimeSummary,
  useStartTimer,
  useStopTimer,
  useAddTimeEntry,
  useDeleteTimeEntry,
  parseDuration,
  type TimeSummary,
} from './useTimeTracking';
// formatDuration from useTimeTracking takes seconds; use useMetrics.formatDuration (takes ms) via barrel
export * from './useToast';
export * from './useWebSocket';
export * from './useWorktree';
