import { useState } from 'react';
import { Bookmark, Edit3, Filter, Save, Search, Star, StarOff, Trash2, X } from 'lucide-react';
import { ActionIcon, Badge, Button, Group, Select, Text, TextInput, Tooltip } from '@mantine/core';
import type { BoardSavedView, Task, TaskType } from '@veritas-kanban/shared';
import { useTaskTypes } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import { useConfig } from '@/hooks/useConfig';
import { UiModal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiAction } from '@/components/ui/UiVocabulary';

export interface FilterState {
  search: string;
  project: string | null;
  type: TaskType | null;
  agent: string | null;
}

interface FilterBarProps {
  tasks: Task[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  savedViews?: BoardSavedView[];
  selectedSavedViewId?: string | null;
  defaultSavedViewId?: string | null;
  hasUnsavedSavedViewChanges?: boolean;
  isSavingSavedView?: boolean;
  onApplySavedView?: (viewId: string) => void;
  onClearSelectedSavedView?: () => void;
  onSaveSavedView?: (name: string) => void;
  onUpdateSavedView?: (viewId: string) => void;
  onRenameSavedView?: (viewId: string, name: string) => void;
  onDeleteSavedView?: (viewId: string) => void;
  onSetDefaultSavedView?: (viewId: string | null) => void;
}

type SavedViewNameModalMode = 'create' | 'rename' | null;

export function FilterBar({
  filters,
  onFiltersChange,
  savedViews = [],
  selectedSavedViewId = null,
  defaultSavedViewId = null,
  hasUnsavedSavedViewChanges = false,
  isSavingSavedView = false,
  onApplySavedView,
  onClearSelectedSavedView,
  onSaveSavedView,
  onUpdateSavedView,
  onRenameSavedView,
  onDeleteSavedView,
  onSetDefaultSavedView,
}: FilterBarProps) {
  const { data: taskTypes = [], isLoading: typesLoading } = useTaskTypes();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: config } = useConfig();
  const [nameModalMode, setNameModalMode] = useState<SavedViewNameModalMode>(null);
  const [viewName, setViewName] = useState('');
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);
  const agents = config?.agents || [];
  const selectedSavedView = savedViews.find((view) => view.id === selectedSavedViewId) ?? null;
  const deleteSavedView = savedViews.find((view) => view.id === deleteViewId) ?? null;
  const isSelectedSavedViewDefault =
    selectedSavedView !== null && selectedSavedView.id === defaultSavedViewId;
  const savedViewOptions = [
    { value: 'custom', label: 'Current filters' },
    ...savedViews.map((view) => ({
      value: view.id,
      label: view.id === defaultSavedViewId ? `${view.name} (default)` : view.name,
    })),
  ];
  const shouldShowSavedViews = Boolean(onSaveSavedView || savedViews.length > 0);
  const projectOptions = [
    { value: 'all', label: 'All Projects' },
    ...projects.map((project) => ({ value: project.id, label: project.label })),
  ];
  const typeOptions = [
    { value: 'all', label: 'All Types' },
    ...taskTypes.map((type) => ({ value: type.id, label: type.label })),
  ];
  const agentOptions = [
    { value: 'all', label: 'All Agents' },
    { value: 'auto', label: 'Auto (routing)' },
    { value: 'unassigned', label: 'Unassigned' },
    ...agents.map((agent) => ({ value: agent.type, label: agent.name })),
  ];

  // Count active filters
  const activeFilterCount = [filters.search, filters.project, filters.type, filters.agent].filter(
    Boolean
  ).length;

  const clearAllFilters = () => {
    onFiltersChange({ search: '', project: null, type: null, agent: null });
  };

  const updateSearch = (value: string) => {
    onFiltersChange({ ...filters, search: value });
  };

  const openCreateSavedView = () => {
    setViewName(`Board view ${savedViews.length + 1}`);
    setNameModalMode('create');
  };

  const openRenameSavedView = () => {
    if (!selectedSavedView) return;
    setViewName(selectedSavedView.name);
    setNameModalMode('rename');
  };

  const closeNameModal = () => {
    setNameModalMode(null);
    setViewName('');
  };

  const submitSavedViewName = () => {
    const name = viewName.trim();
    if (!name) return;

    if (nameModalMode === 'create') {
      onSaveSavedView?.(name);
    } else if (nameModalMode === 'rename' && selectedSavedView) {
      onRenameSavedView?.(selectedSavedView.id, name);
    }

    closeNameModal();
  };

  const handleSavedViewChange = (value: string | null) => {
    if (!value || value === 'custom') {
      onClearSelectedSavedView?.();
      return;
    }
    onApplySavedView?.(value);
  };

  const confirmDeleteSavedView = () => {
    if (!deleteViewId) return;
    onDeleteSavedView?.(deleteViewId);
    setDeleteViewId(null);
  };

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      <div
        className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3"
        role="search"
        aria-label="Filter tasks"
      >
        {/* Search */}
        <div className="relative w-full sm:max-w-sm sm:flex-1">
          <TextInput
            id="task-search"
            aria-label="Search tasks"
            placeholder="Search tasks..."
            value={filters.search}
            onChange={(e) => updateSearch(e.target.value)}
            leftSection={<Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            rightSectionPointerEvents="auto"
            rightSection={
              filters.search ? (
                <ActionIcon
                  aria-label="Clear search"
                  variant="subtle"
                  size="sm"
                  onClick={() => updateSearch('')}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </ActionIcon>
              ) : null
            }
            aria-describedby={activeFilterCount > 0 ? 'active-filter-count' : undefined}
          />
        </div>

        {/* Project filter */}
        <Select
          value={filters.project || 'all'}
          onChange={(value) =>
            onFiltersChange({ ...filters, project: value && value !== 'all' ? value : null })
          }
          disabled={projectsLoading}
          data={projectOptions}
          aria-label="Filter by project"
          className="w-full sm:w-[160px]"
          allowDeselect={false}
        />

        {/* Type filter */}
        <Select
          value={filters.type || 'all'}
          onChange={(value) =>
            onFiltersChange({
              ...filters,
              type: value && value !== 'all' ? (value as TaskType) : null,
            })
          }
          disabled={typesLoading}
          data={typeOptions}
          aria-label="Filter by type"
          className="w-full sm:w-[160px]"
          allowDeselect={false}
        />

        {/* Agent filter */}
        <Select
          value={filters.agent || 'all'}
          onChange={(value) =>
            onFiltersChange({ ...filters, agent: value && value !== 'all' ? value : null })
          }
          data={agentOptions}
          aria-label="Filter by agent"
          className="w-full sm:w-[160px]"
          allowDeselect={false}
        />

        {/* Active filter indicator & clear */}
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2">
            <Badge
              id="active-filter-count"
              variant="light"
              color="gray"
              leftSection={<Filter className="h-3 w-3" aria-hidden="true" />}
              aria-live="polite"
            >
              {activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}
            </Badge>
            <Button
              variant="subtle"
              size="xs"
              onClick={clearAllFilters}
              aria-label="Clear all filters"
              className="text-muted-foreground hover:text-foreground"
            >
              Clear all
            </Button>
          </div>
        )}
      </div>

      {shouldShowSavedViews && (
        <div
          className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center"
          aria-label="Saved board views"
        >
          <Select
            value={selectedSavedView?.id ?? 'custom'}
            onChange={handleSavedViewChange}
            data={savedViewOptions}
            aria-label="Saved board view"
            className="w-full sm:w-[220px]"
            allowDeselect={false}
            leftSection={<Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
          />
          <Group gap="xs" wrap="nowrap" className="min-w-0">
            <Button
              variant="light"
              size="xs"
              leftSection={<Save className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={openCreateSavedView}
              loading={isSavingSavedView && nameModalMode === 'create'}
            >
              Save view
            </Button>
            {selectedSavedView && (
              <>
                <Tooltip label="Update saved view">
                  <ActionIcon
                    variant={hasUnsavedSavedViewChanges ? 'filled' : 'subtle'}
                    size="sm"
                    aria-label="Update saved view"
                    onClick={() => onUpdateSavedView?.(selectedSavedView.id)}
                    loading={isSavingSavedView}
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Rename saved view">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label="Rename saved view"
                    onClick={openRenameSavedView}
                  >
                    <Edit3 className="h-4 w-4" aria-hidden="true" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label={
                    isSelectedSavedViewDefault
                      ? 'Clear default saved view'
                      : 'Set saved view as default'
                  }
                >
                  <ActionIcon
                    variant={isSelectedSavedViewDefault ? 'light' : 'subtle'}
                    size="sm"
                    aria-label={
                      isSelectedSavedViewDefault
                        ? 'Clear default saved view'
                        : 'Set saved view as default'
                    }
                    onClick={() =>
                      onSetDefaultSavedView?.(
                        isSelectedSavedViewDefault ? null : selectedSavedView.id
                      )
                    }
                  >
                    {isSelectedSavedViewDefault ? (
                      <StarOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Star className="h-4 w-4" aria-hidden="true" />
                    )}
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete saved view">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    aria-label="Delete saved view"
                    onClick={() => setDeleteViewId(selectedSavedView.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </ActionIcon>
                </Tooltip>
                {hasUnsavedSavedViewChanges && (
                  <Badge variant="light" color="yellow">
                    Modified
                  </Badge>
                )}
              </>
            )}
          </Group>
        </div>
      )}

      <UiModal
        opened={nameModalMode !== null}
        onClose={closeNameModal}
        title={nameModalMode === 'rename' ? 'Rename saved view' : 'Save board view'}
        variant="form"
        compound
      >
        <div className="vk-overlay-scroll">
          <TextInput
            label="View name"
            value={viewName}
            onChange={(event) => setViewName(event.currentTarget.value)}
            data-autofocus
            maxLength={80}
          />
        </div>
        <OverlayFooter>
          <UiAction variant="quiet" onClick={closeNameModal}>
            Cancel
          </UiAction>
          <UiAction onClick={submitSavedViewName} disabled={!viewName.trim()}>
            {nameModalMode === 'rename' ? 'Rename' : 'Save'}
          </UiAction>
        </OverlayFooter>
      </UiModal>

      <UiModal
        opened={Boolean(deleteSavedView)}
        onClose={() => setDeleteViewId(null)}
        title="Delete saved view?"
        variant="confirm"
        compound
      >
        <div className="vk-overlay-scroll">
          <Text size="sm" className="break-words">
            Delete "{deleteSavedView?.name}"? Current filters and shared URLs stay unchanged.
          </Text>
        </div>
        <OverlayFooter>
          <UiAction variant="quiet" data-autofocus onClick={() => setDeleteViewId(null)}>
            Cancel
          </UiAction>
          <UiAction variant="destructive" onClick={confirmDeleteSavedView}>
            Delete
          </UiAction>
        </OverlayFooter>
      </UiModal>
    </div>
  );
}

// URL sync helpers
export function filtersToSearchParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set('q', filters.search);
  if (filters.project) params.set('project', filters.project);
  if (filters.type) params.set('type', filters.type);
  if (filters.agent) params.set('agent', filters.agent);
  return params;
}

export function searchParamsToFilters(params: URLSearchParams): FilterState {
  return {
    search: params.get('q') || '',
    project: params.get('project') || null,
    type: (params.get('type') as TaskType) || null,
    agent: params.get('agent') || null,
  };
}

// Filter function
export function filterTasks(tasks: Task[], filters: FilterState): Task[] {
  return tasks.filter((task) => {
    // Search filter (title + description + task ID)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const titleMatch = task.title.toLowerCase().includes(searchLower);
      const descMatch = task.description?.toLowerCase().includes(searchLower);
      const idMatch = task.id.toLowerCase().includes(searchLower);
      if (!titleMatch && !descMatch && !idMatch) return false;
    }

    // Project filter
    if (filters.project && task.project !== filters.project) {
      return false;
    }

    // Type filter
    if (filters.type && task.type !== filters.type) {
      return false;
    }

    // Agent filter
    if (filters.agent) {
      if (filters.agent === 'unassigned') {
        if (task.agent) return false;
      } else if (filters.agent === 'auto') {
        if (task.agent !== 'auto') return false;
      } else {
        if (task.agent !== filters.agent) return false;
      }
    }

    return true;
  });
}
