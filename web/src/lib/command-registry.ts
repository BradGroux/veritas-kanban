import { VIEW_DEFINITIONS, type AppView, type ViewIcon } from './views';

export type ThemeMode = 'dark' | 'light';

export type CommandCategory = 'Actions' | 'Navigation' | 'Board';

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
      label: 'Search Tasks, Docs, and Work Products',
      icon: 'Sparkles',
      category: 'Actions',
      action: { type: 'open-search' },
      keywords: ['qmd', 'semantic', 'retrieval', 'docs', 'archive', 'work products'],
      aliases: ['find', 'universal search', 'command search'],
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
