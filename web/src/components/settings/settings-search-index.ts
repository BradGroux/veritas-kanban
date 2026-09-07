import type { ClientAuthPermission } from '@veritas-kanban/shared';

export interface SettingsSearchEntry {
  id: string;
  section: string;
  title: string;
  description: string;
  keywords?: string;
  controlId?: string;
  requiredPermission?: ClientAuthPermission;
  optionalInBoardOnly?: boolean;
}

export const SETTINGS_SECTION_DESCRIPTIONS: Record<string, string> = {
  general: 'Appearance, product mode, display name and defaults',
  board: 'Columns, card display and board behavior',
  tasks: 'Task behavior, verification and editing',
  agents: 'Agent providers, runtime and routing',
  data: 'Telemetry retention, budgets and archiving',
  notifications: 'Delivery channels and alerts',
  'multi-user': 'Workspace members, devices and API access',
  'workspace-capabilities': 'Workspace capabilities and connections',
  delegation: 'Agent coordination and delegation rules',
  scheduler: 'Scheduled workflow execution',
  'queue-monitors': 'Workflow queue monitoring',
  reflections: 'Reusable lessons and extraction',
  trackers: 'External issue tracker connections',
  security: 'Password changes and account recovery',
  'tool-policies': 'Tool access and approval policies',
  enforcement: 'Quality and completion requirements',
  'shared-resources': 'Shared references and resources',
  'doc-freshness': 'Documentation freshness checks',
  maintenance: 'Backups, restore, logs and storage maintenance',
  manage: 'Manage stored task data and cleanup',
};

export const SETTINGS_CONTROL_INDEX: SettingsSearchEntry[] = [
  {
    id: 'theme',
    section: 'general',
    title: 'Theme and appearance',
    description: 'Choose the appearance for this browser or desktop app',
    keywords: 'dark light system color',
    controlId: 'general-appearance',
  },
  {
    id: 'product-mode',
    section: 'general',
    title: 'Product mode',
    description: 'Choose which surfaces and shortcuts to emphasize',
    keywords: 'board only advanced focus preset',
    controlId: 'general-product-mode',
  },
  {
    id: 'default-agent',
    section: 'general',
    title: 'Default agent',
    description: 'Agent selected when a task does not specify one',
    keywords: 'default agent provider',
    controlId: 'general-default-agent',
    requiredPermission: 'agent:read',
    optionalInBoardOnly: true,
  },
  {
    id: 'backup',
    section: 'maintenance',
    title: 'Backup and restore',
    description: 'Export or import a SQLite backup bundle',
    keywords: 'backup restore export import recovery database',
    controlId: 'maintenance-backup',
    requiredPermission: 'backup:read',
  },
  {
    id: 'token',
    section: 'multi-user',
    title: 'API tokens',
    description: 'Manage scoped API access for this workspace',
    keywords: 'token api key credential access',
    controlId: 'multi-user-api-access',
    requiredPermission: 'admin:manage',
  },
  {
    id: 'archive',
    section: 'data',
    title: 'Archive settings',
    description: 'Configure task archiving behavior',
    keywords: 'archive retention',
    controlId: 'data-archive',
    requiredPermission: 'backup:read',
  },
  {
    id: 'markdown',
    section: 'tasks',
    title: 'Markdown editor',
    description: 'Configure task description editing',
    keywords: 'markdown editor preview',
    controlId: 'task-markdown',
  },
];

export function settingsSupportHash(section: string, controlId?: string): string {
  return `#settings/${encodeURIComponent(section)}${controlId ? `/${encodeURIComponent(controlId)}` : ''}`;
}

export function parseSettingsSupportHash(
  hash: string
): { section: string; control?: string } | null {
  const match = /^#settings\/([a-z][a-z-]*)(?:\/([a-z][a-z-]*))?$/.exec(hash);
  return match ? { section: match[1], control: match[2] } : null;
}

export function searchSettings(
  entries: SettingsSearchEntry[],
  query: string,
  boardOnly: boolean
): SettingsSearchEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries
    .filter((entry) => {
      const haystack = `${entry.title} ${entry.description} ${entry.keywords ?? ''}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(
      (a, b) =>
        Number(boardOnly && !!a.optionalInBoardOnly) - Number(boardOnly && !!b.optionalInBoardOnly)
    );
}
