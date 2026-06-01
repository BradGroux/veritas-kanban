import { Search, X, Filter } from 'lucide-react';
import { ActionIcon, Badge, Button, Select, TextInput } from '@mantine/core';
import type { Task, TaskType } from '@veritas-kanban/shared';
import { useTaskTypes } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import { useConfig } from '@/hooks/useConfig';

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
}

export function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const { data: taskTypes = [], isLoading: typesLoading } = useTaskTypes();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: config } = useConfig();
  const agents = config?.agents || [];
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

  return (
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
