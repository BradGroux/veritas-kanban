import type { ProductModeId } from '@veritas-kanban/shared';

export const PRODUCT_MODE_PENDING_STORAGE_KEY = 'veritas-product-mode-pending';

export interface ProductModeDefinition {
  id: ProductModeId;
  label: string;
  description: string;
  focus: string[];
  visibleSurfaces: string[];
  defaultTaskTemplate: string;
  commandShortcuts: string[];
}

export const PRODUCT_MODE_DEFINITIONS: ProductModeDefinition[] = [
  {
    id: 'board-only',
    label: 'Board Only',
    description:
      'Focused local board with optional agent, workflow, and remote surfaces de-emphasized.',
    focus: ['Board', 'task detail', 'basic search'],
    visibleSurfaces: ['board', 'backlog', 'archive'],
    defaultTaskTemplate: 'Simple task',
    commandShortcuts: ['New task', 'Search tasks'],
  },
  {
    id: 'agent-ready',
    label: 'Agent Ready',
    description: 'Board plus agent runs, templates, work products, and local diagnostics.',
    focus: ['board', 'agent panel', 'run history'],
    visibleSurfaces: ['board', 'templates', 'workflows', 'settings agents'],
    defaultTaskTemplate: 'Agent-ready task',
    commandShortcuts: ['Start agent', 'Open run timeline'],
  },
  {
    id: 'solo-coding',
    label: 'Solo Coding',
    description:
      'Code-heavy flow with repo, branch, QA gate, and completion packet surfaces nearby.',
    focus: ['repository', 'run mode', 'QA gate'],
    visibleSurfaces: ['board', 'task work', 'workflow runs', 'work products'],
    defaultTaskTemplate: 'Implementation task',
    commandShortcuts: ['Assign agent', 'Open PR', 'Generate packet'],
  },
  {
    id: 'pm-orchestration',
    label: 'PM Orchestration',
    description:
      'Planning and delegation flow with workflows, decisions, policy traces, and dashboards.',
    focus: ['roadmap', 'delegation', 'decision traces'],
    visibleSurfaces: ['board', 'workflows', 'decisions', 'policies'],
    defaultTaskTemplate: 'Coordinated delivery task',
    commandShortcuts: ['Build workflow', 'Open decisions'],
  },
  {
    id: 'qa-review',
    label: 'QA Review',
    description: 'Review-focused flow with risk queues, QA gates, verification, and run evidence.',
    focus: ['needs attention', 'QA gate', 'verification'],
    visibleSurfaces: ['board', 'needs attention', 'workflow runs', 'work products'],
    defaultTaskTemplate: 'Review and QA task',
    commandShortcuts: ['Open QA gate', 'Open evidence'],
  },
  {
    id: 'research',
    label: 'Research',
    description:
      'Read-heavy workflow for notes, references, decision records, and stale-doc follow-up.',
    focus: ['notes', 'references', 'docs freshness'],
    visibleSurfaces: ['board', 'decisions', 'shared resources', 'search'],
    defaultTaskTemplate: 'Research task',
    commandShortcuts: ['Open search', 'Record decision'],
  },
  {
    id: 'operations',
    label: 'Operations',
    description:
      'Operational flow with maintenance, storage, health, remote sessions, and recovery surfaces.',
    focus: ['maintenance', 'health', 'backup'],
    visibleSurfaces: ['settings maintenance', 'system health', 'multi-user', 'notifications'],
    defaultTaskTemplate: 'Operational task',
    commandShortcuts: ['Open maintenance', 'Run health check'],
  },
  {
    id: 'advanced',
    label: 'Advanced / Operator',
    description:
      'All surfaces visible by default for operators who want the full v5 control plane.',
    focus: ['all dashboards', 'all settings', 'all workflow controls'],
    visibleSurfaces: ['all'],
    defaultTaskTemplate: 'Advanced task',
    commandShortcuts: ['Command palette', 'Open settings'],
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Manual configuration. Veritas records the preference without applying a preset.',
    focus: ['manual layout', 'manual controls'],
    visibleSurfaces: ['configured surfaces'],
    defaultTaskTemplate: 'Custom task',
    commandShortcuts: ['Command palette'],
  },
];

export function productModeDefinition(id: ProductModeId): ProductModeDefinition {
  return (
    PRODUCT_MODE_DEFINITIONS.find((definition) => definition.id === id) ??
    PRODUCT_MODE_DEFINITIONS.find((definition) => definition.id === 'advanced')!
  );
}

export function productModeForSetupMode(
  mode: 'board' | 'agent' | 'remote' | 'restore'
): ProductModeId {
  if (mode === 'board') return 'board-only';
  if (mode === 'agent') return 'agent-ready';
  return 'operations';
}

export function persistPendingProductMode(mode: ProductModeId): void {
  try {
    window.localStorage.setItem(PRODUCT_MODE_PENDING_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in restricted contexts.
  }
}

export function readPendingProductMode(): ProductModeId | null {
  try {
    const value = window.localStorage.getItem(PRODUCT_MODE_PENDING_STORAGE_KEY);
    return PRODUCT_MODE_DEFINITIONS.some((definition) => definition.id === value)
      ? (value as ProductModeId)
      : null;
  } catch {
    return null;
  }
}

export function clearPendingProductMode(): void {
  try {
    window.localStorage.removeItem(PRODUCT_MODE_PENDING_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted contexts.
  }
}
