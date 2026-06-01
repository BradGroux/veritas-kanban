import { useQuery } from '@tanstack/react-query';
import type { TaskTypeConfig } from '@veritas-kanban/shared';
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

/**
 * Get the color class for a task type
 */
export function getTypeColor(types: TaskTypeConfig[], typeId: string): string {
  const type = types.find((t) => t.id === typeId);
  return type?.color || 'border-l-gray-500';
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
 * Available border colors for task types
 */
export const AVAILABLE_COLORS = [
  { value: 'border-l-gray-500', label: 'Gray' },
  { value: 'border-l-violet-500', label: 'Violet' },
  { value: 'border-l-cyan-500', label: 'Cyan' },
  { value: 'border-l-orange-500', label: 'Orange' },
  { value: 'border-l-emerald-500', label: 'Emerald' },
  { value: 'border-l-fuchsia-500', label: 'Pink' },
  { value: 'border-l-amber-500', label: 'Amber' },
  { value: 'border-l-blue-700', label: 'Blue' },
  { value: 'border-l-green-700', label: 'Green' },
  { value: 'border-l-red-500', label: 'Red' },
  { value: 'border-l-purple-500', label: 'Purple' },
  { value: 'border-l-yellow-400', label: 'Yellow' },
  { value: 'border-l-amber-800', label: 'Brown' },
];
