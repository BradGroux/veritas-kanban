import { useQuery } from '@tanstack/react-query';
import {
  TASK_TYPE_COLOR_TOKENS,
  type TaskTypeColorToken,
  type TaskTypeConfig,
} from '@veritas-kanban/shared';
import * as LucideIcons from 'lucide-react';
import { useManagedList } from './useManagedList';
import { apiFetch } from '@/lib/api/helpers';

type LucideIconComponent = React.ForwardRefExoticComponent<
  Omit<React.SVGProps<SVGSVGElement>, 'ref'> & React.RefAttributes<SVGSVGElement>
>;

/**
 * Hook to fetch and manage task types
 */
export function useTaskTypes() {
  return useQuery<TaskTypeConfig[]>({
    queryKey: ['task-types'],
    queryFn: () => apiFetch<TaskTypeConfig[]>('/api/task-types'),
  });
}

/**
 * Hook to manage task types (CRUD operations)
 */
export function useTaskTypesManager() {
  return useManagedList<TaskTypeConfig>({
    endpoint: '/task-types',
    queryKey: ['task-types'],
  });
}

/**
 * Map of common Lucide icon names to components
 */
const ICON_MAP: Record<string, LucideIconComponent> = {
  Code: LucideIcons.Code,
  Search: LucideIcons.Search,
  FileText: LucideIcons.FileText,
  Zap: LucideIcons.Zap,
  Lightbulb: LucideIcons.Lightbulb,
  Bug: LucideIcons.Bug,
  Settings: LucideIcons.Settings,
  Package: LucideIcons.Package,
  Wrench: LucideIcons.Wrench,
  Database: LucideIcons.Database,
  Globe: LucideIcons.Globe,
  Mail: LucideIcons.Mail,
  MessageSquare: LucideIcons.MessageSquare,
  Image: LucideIcons.Image,
  Video: LucideIcons.Video,
  Music: LucideIcons.Music,
  Palette: LucideIcons.Palette,
  Newspaper: LucideIcons.Newspaper,
  BookOpen: LucideIcons.BookOpen,
  GraduationCap: LucideIcons.GraduationCap,
};

/**
 * Get Lucide icon component by name
 */
export function getTypeIcon(iconName: string): LucideIconComponent | null {
  return ICON_MAP[iconName] || null;
}

/**
 * Get all available icon names
 */
export function getAvailableIcons(): string[] {
  return Object.keys(ICON_MAP);
}

const LEGACY_COLOR_TOKENS: Readonly<Record<string, TaskTypeColorToken>> = {
  'border-l-gray-500': 'neutral',
  'border-l-violet-500': 'violet',
  'border-l-cyan-500': 'cyan',
  'border-l-orange-500': 'orange',
  'border-l-emerald-500': 'emerald',
  'border-l-fuchsia-500': 'rose',
  'border-l-amber-500': 'amber',
  'border-l-blue-700': 'blue',
  'border-l-green-700': 'emerald',
  'border-l-red-500': 'red',
  'border-l-purple-500': 'violet',
  'border-l-yellow-400': 'amber',
  'border-l-amber-800': 'umber',
};

export function normalizeTaskTypeColorToken(value?: string): TaskTypeColorToken {
  if (TASK_TYPE_COLOR_TOKENS.includes(value as TaskTypeColorToken)) {
    return value as TaskTypeColorToken;
  }
  return LEGACY_COLOR_TOKENS[value ?? ''] ?? 'neutral';
}

export function getTypeColorToken(types: TaskTypeConfig[], typeId: string): TaskTypeColorToken {
  const type = types.find((candidate) => candidate.id === typeId);
  return normalizeTaskTypeColorToken(type?.colorToken ?? type?.color);
}

/**
 * Get the label for a task type
 */
export function getTypeLabel(types: TaskTypeConfig[], typeId: string): string {
  const type = types.find((t) => t.id === typeId);
  return type?.label || typeId;
}

/**
 * Get the icon name for a task type
 */
export function getTypeIconName(types: TaskTypeConfig[], typeId: string): string {
  const type = types.find((t) => t.id === typeId);
  return type?.icon || 'Code';
}

/**
 * Semantic task identity colors. Rendering derives theme-aware surfaces from these tokens.
 */
export const AVAILABLE_COLORS = [
  { value: 'neutral', label: 'Graphite' },
  { value: 'violet', label: 'Violet' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'orange', label: 'Orange' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'rose', label: 'Rose' },
  { value: 'amber', label: 'Amber' },
  { value: 'blue', label: 'Blue' },
  { value: 'red', label: 'Red' },
  { value: 'umber', label: 'Umber' },
] satisfies Array<{ value: TaskTypeColorToken; label: string }>;
