import { VIEW_DEFINITIONS, type AppView, type ViewIcon } from './views';

export type ThemeMode = 'dark' | 'light';

export type CommandCategory = 'Actions' | 'Navigation' | 'Board' | 'Diagnostics';

export type CommandIcon =
  | ViewIcon
  | 'ArrowRight'
  | 'Keyboard'
  | 'Moon'
  | 'Plus'
  | 'Sparkles'
  | 'Sun';

export type BoardShortcutCommand =
  | 'move-todo'
  | 'move-inprogress'
  | 'move-blocked'
  | 'move-done'
  | 'nav-up'
  | 'nav-down'
  | 'open-task';

export type CommandAction =
  | { type: 'open-create-task' }
  | { type: 'toggle-theme' }
  | { type: 'open-search' }
  | { type: 'open-settings'; section?: string }
  | { type: 'open-diagnostics' }
  | { type: 'navigate-view'; view: AppView }
  | { type: 'board-shortcut'; shortcut: BoardShortcutCommand };

export interface CommandDescriptor {
  id: string;
  label: string;
  category: CommandCategory;
  action: CommandAction;
  icon: CommandIcon;
  shortcut?: string;
  keywords?: readonly string[];
  aliases?: readonly string[];
  disabledReason?: string;
}

const SELECTED_TASK_REQUIRED = 'Select a task on the board to use this shortcut.';

const BOARD_SHORTCUTS: readonly CommandDescriptor[] = [
  {
    id: 'move-todo',
    label: 'Move Task to To Do',
    shortcut: '1',
    icon: 'ArrowRight',
    category: 'Board',
    action: { type: 'board-shortcut', shortcut: 'move-todo' },
    keywords: ['status', 'move', 'todo'],
    disabledReason: SELECTED_TASK_REQUIRED,
  },
  {
    id: 'move-inprogress',
    label: 'Move Task to In Progress',
    shortcut: '2',
    icon: 'ArrowRight',
    category: 'Board',
    action: { type: 'board-shortcut', shortcut: 'move-inprogress' },
    keywords: ['status', 'move', 'progress'],
    disabledReason: SELECTED_TASK_REQUIRED,
  },
  {
    id: 'move-blocked',
    label: 'Move Task to Blocked',
    shortcut: '3',
    icon: 'ArrowRight',
    category: 'Board',
    action: { type: 'board-shortcut', shortcut: 'move-blocked' },
    keywords: ['status', 'move', 'blocked'],
    disabledReason: SELECTED_TASK_REQUIRED,
  },
  {
    id: 'move-done',
    label: 'Move Task to Done',
    shortcut: '4',
    icon: 'ArrowRight',
    category: 'Board',
    action: { type: 'board-shortcut', shortcut: 'move-done' },
    keywords: ['status', 'move', 'complete', 'done'],
    disabledReason: SELECTED_TASK_REQUIRED,
  },
  {
    id: 'nav-up',
    label: 'Select Previous Task',
    shortcut: 'K / Up',
    icon: 'Keyboard',
    category: 'Board',
    action: { type: 'board-shortcut', shortcut: 'nav-up' },
    keywords: ['navigate', 'up', 'previous'],
    disabledReason: SELECTED_TASK_REQUIRED,
  },
  {
    id: 'nav-down',
    label: 'Select Next Task',
    shortcut: 'J / Down',
    icon: 'Keyboard',
    category: 'Board',
    action: { type: 'board-shortcut', shortcut: 'nav-down' },
    keywords: ['navigate', 'down', 'next'],
    disabledReason: SELECTED_TASK_REQUIRED,
  },
  {
    id: 'open-task',
    label: 'Open Selected Task',
    shortcut: 'Enter',
    icon: 'Keyboard',
    category: 'Board',
    action: { type: 'board-shortcut', shortcut: 'open-task' },
    keywords: ['view', 'detail', 'open', 'work', 'work view'],
    aliases: ['open work view', 'task work'],
    disabledReason: SELECTED_TASK_REQUIRED,
  },
];

export interface CommandRegistryOptions {
  theme: ThemeMode;
  includeBoardShortcuts?: boolean;
}

export function createCommandRegistry({
  theme,
  includeBoardShortcuts = true,
}: CommandRegistryOptions): readonly CommandDescriptor[] {
  const commands: CommandDescriptor[] = [
    {
      id: 'new-task',
      label: 'New Task',
      shortcut: 'C',
      icon: 'Plus',
      category: 'Actions',
      action: { type: 'open-create-task' },
      keywords: ['create', 'add', 'task'],
      aliases: ['task new', 'create task'],
    },
    {
      id: 'toggle-theme',
      label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      icon: theme === 'dark' ? 'Sun' : 'Moon',
      category: 'Actions',
      action: { type: 'toggle-theme' },
      keywords: ['theme', 'dark', 'light', 'mode', 'appearance'],
      aliases: ['appearance'],
    },
    {
      id: 'open-search',
      label: 'Universal Search',
      icon: 'Sparkles',
      category: 'Actions',
      action: { type: 'open-search' },
      keywords: [
        'qmd',
        'semantic',
        'retrieval',
        'docs',
        'archive',
        'work products',
        'runs',
        'policies',
        'notifications',
      ],
      aliases: ['find', 'search', 'universal search', 'command search', 'jump to'],
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      icon: 'ShieldAlert',
      category: 'Actions',
      action: { type: 'open-settings' },
      keywords: ['configuration', 'features', 'security', 'identity', 'preferences'],
      aliases: ['settings', 'preferences', 'config'],
    },
    {
      id: 'open-diagnostics',
      label: 'Open Logs and Diagnostics',
      icon: 'Activity',
      category: 'Diagnostics',
      action: { type: 'open-diagnostics' },
      keywords: ['logs', 'diagnostics', 'health', 'desktop', 'communication', 'troubleshoot'],
      aliases: ['logs', 'diagnostics', 'health check'],
    },
    {
      id: 'start-workflow',
      label: 'Start Workflow',
      icon: 'Workflow',
      category: 'Actions',
      action: { type: 'navigate-view', view: 'workflows' },
      keywords: ['run', 'automation', 'execute'],
      aliases: ['run workflow', 'workflow start'],
    },
    {
      id: 'apply-template',
      label: 'Apply Template to Selected Task',
      icon: 'FileText',
      category: 'Board',
      action: { type: 'board-shortcut', shortcut: 'open-task' },
      keywords: ['template', 'task', 'apply', 'prompt'],
      aliases: ['apply template', 'task template'],
      disabledReason: SELECTED_TASK_REQUIRED,
    },
    {
      id: 'copy-completion-packet',
      label: 'Copy Completion Packet',
      icon: 'FileText',
      category: 'Board',
      action: { type: 'board-shortcut', shortcut: 'open-task' },
      keywords: ['completion', 'packet', 'copy', 'summary', 'handoff'],
      aliases: ['completion packet', 'copy packet'],
      disabledReason: SELECTED_TASK_REQUIRED,
    },
    {
      id: 'restart-local-server',
      label: 'Restart Local Server',
      icon: 'Activity',
      category: 'Diagnostics',
      action: { type: 'open-diagnostics' },
      keywords: ['server', 'restart', 'desktop', 'local'],
      aliases: ['restart server'],
      disabledReason: 'The desktop bridge does not expose server restart from the web app yet.',
    },
    {
      id: 'check-for-updates',
      label: 'Check for Updates',
      icon: 'Activity',
      category: 'Diagnostics',
      action: { type: 'open-diagnostics' },
      keywords: ['updates', 'release', 'desktop', 'version'],
      aliases: ['updates', 'check updates'],
      disabledReason: 'The desktop bridge does not expose update checks from the web app yet.',
    },
    ...VIEW_DEFINITIONS.map(
      (definition): CommandDescriptor => ({
        id: `go-${definition.view}`,
        label: definition.commandLabel,
        shortcut: definition.view === 'board' ? 'B' : undefined,
        icon: definition.icon,
        category: 'Navigation',
        action: { type: 'navigate-view', view: definition.view },
        keywords: definition.keywords,
        aliases: [definition.label.toLowerCase()],
      })
    ),
  ];

  if (includeBoardShortcuts) {
    commands.push(...BOARD_SHORTCUTS);
  }

  return commands;
}
