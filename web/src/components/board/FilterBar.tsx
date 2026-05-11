import { Search, X, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { Task, TaskType } from '@veritas-kanban/shared';
import {
  HERMES_AGENT_DISPLAY_NAMES,
  HERMES_AGENT_ROSTER,
  isHermesAgentId,
} from '@veritas-kanban/shared';
import { useTaskTypes, getTypeIcon } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import { useConfig } from '@/hooks/useConfig';
import { useGlobalAgentStatus } from '@/hooks/useGlobalAgentStatus';

function formatAgentLabel(agent: string): string {
  return agent
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

function normalizeAgentKey(agent: string): string {
  return agent.trim().toLowerCase();
}

const HERMES_AGENT_ROSTER_SET = new Set<string>(HERMES_AGENT_ROSTER);

const HERMES_AGENT_LABELS: Record<string, string> = HERMES_AGENT_DISPLAY_NAMES;

function isHermesAgentRosterAgent(agent: string | null | undefined): agent is string {
  const trimmedValue = agent?.trim();
  if (!trimmedValue) return false;
  const key = normalizeAgentKey(trimmedValue);
  return isHermesAgentId(key) && HERMES_AGENT_ROSTER_SET.has(key);
}

interface AgentOption {
  value: string;
  label: string;
}

function addAgentOption(
  agents: Map<string, AgentOption>,
  value: string | null | undefined,
  label?: string | null
): void {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return;

  const key = normalizeAgentKey(trimmedValue);
  if (!agents.has(key)) {
    agents.set(key, {
      value: trimmedValue,
      label: label?.trim() || formatAgentLabel(trimmedValue),
    });
  }
}

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

export function FilterBar({ tasks, filters, onFiltersChange }: FilterBarProps) {
  const { data: taskTypes = [], isLoading: typesLoading } = useTaskTypes();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: config } = useConfig();
  const { data: agentStatus } = useGlobalAgentStatus();
  const agents = new Map<string, AgentOption>();
  for (const agent of config?.agents || []) {
    if (agent.enabled && isHermesAgentRosterAgent(agent.type)) {
      const key = normalizeAgentKey(agent.type);
      addAgentOption(agents, agent.type, HERMES_AGENT_LABELS[key] || agent.name);
    }
  }
  for (const activeAgent of agentStatus?.activeAgents || []) {
    if (isHermesAgentRosterAgent(activeAgent.agent)) {
      const key = normalizeAgentKey(activeAgent.agent);
      addAgentOption(agents, activeAgent.agent, HERMES_AGENT_LABELS[key] || activeAgent.agent);
    }
  }
  for (const task of tasks) {
    if (task.agent && task.agent !== 'auto' && isHermesAgentRosterAgent(task.agent)) {
      const key = normalizeAgentKey(task.agent);
      addAgentOption(agents, task.agent, HERMES_AGENT_LABELS[key]);
    }
  }

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
    <div className="flex items-center gap-3" role="search" aria-label="Filter tasks">
      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <label htmlFor="task-search" className="sr-only">
          Search tasks
        </label>
        <Input
          id="task-search"
          placeholder="Search tasks..."
          value={filters.search}
          onChange={(e) => updateSearch(e.target.value)}
          className="pl-9 pr-9"
          aria-describedby={activeFilterCount > 0 ? 'active-filter-count' : undefined}
        />
        {filters.search && (
          <button
            onClick={() => updateSearch('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Project filter */}
      <Select
        value={filters.project || 'all'}
        onValueChange={(value) =>
          onFiltersChange({ ...filters, project: value === 'all' ? null : value })
        }
        disabled={projectsLoading}
      >
        <SelectTrigger className="w-[160px]" aria-label="Filter by project">
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Projects</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Type filter */}
      <Select
        value={filters.type || 'all'}
        onValueChange={(value) =>
          onFiltersChange({ ...filters, type: value === 'all' ? null : (value as TaskType) })
        }
        disabled={typesLoading}
      >
        <SelectTrigger className="w-[160px]" aria-label="Filter by type">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          {taskTypes.map((type) => {
            const IconComponent = getTypeIcon(type.icon);
            return (
              <SelectItem key={type.id} value={type.id}>
                <div className="flex items-center gap-2">
                  {IconComponent && <IconComponent className="h-4 w-4" />}
                  {type.label}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Agent filter */}
      <Select
        value={filters.agent || 'all'}
        onValueChange={(value) =>
          onFiltersChange({ ...filters, agent: value === 'all' ? null : value })
        }
      >
        <SelectTrigger className="w-[160px]" aria-label="Filter by agent">
          <SelectValue placeholder="All Agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Agents</SelectItem>
          <SelectItem value="auto">Auto (routing)</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {[...agents.values()].map((agent) => (
            <SelectItem key={agent.value} value={agent.value}>
              {agent.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Active filter indicator & clear */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2">
          <Badge id="active-filter-count" variant="secondary" className="gap-1" aria-live="polite">
            <Filter className="h-3 w-3" aria-hidden="true" />
            {activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
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
