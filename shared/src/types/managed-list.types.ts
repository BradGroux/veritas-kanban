// Managed List Types

/** Base interface for managed list items */
export interface ManagedListItem {
  id: string;
  label: string;
  order: number;
  isDefault?: boolean;
  isHidden?: boolean;
  created: string;
  updated: string;
}

/** Configuration options for ManagedListService */
export interface ManagedListServiceOptions {
  filename: string;
  configDir: string;
  defaults: ManagedListItem[];
}

export const TASK_TYPE_COLOR_TOKENS = [
  'neutral',
  'violet',
  'cyan',
  'orange',
  'emerald',
  'rose',
  'amber',
  'blue',
  'red',
  'umber',
] as const;

export type TaskTypeColorToken = (typeof TASK_TYPE_COLOR_TOKENS)[number];

/** Task type configuration with icon and semantic identity color */
export interface TaskTypeConfig extends ManagedListItem {
  icon: string; // Lucide icon name (e.g., "Code", "Search")
  colorToken?: TaskTypeColorToken;
  /** @deprecated Legacy Tailwind border class retained for stored configuration migration. */
  color?: string;
}

/** Project configuration with description and badge color */
export interface ProjectConfig extends ManagedListItem {
  description?: string;
  color?: string; // Tailwind bg color class for badges (e.g., "bg-blue-500/20")
}

/** Sprint configuration */
export interface SprintConfig extends ManagedListItem {
  description?: string;
}
