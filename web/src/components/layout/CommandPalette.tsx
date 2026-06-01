import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Box,
  Group,
  Kbd,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useView } from '@/contexts/ViewContext';
import {
  Plus,
  LayoutDashboard,
  ListOrdered,
  Inbox,
  Archive,
  FileText,
  Search,
  ArrowRight,
  Moon,
  Sun,
  Keyboard,
  Activity,
  GitBranch,
  Sparkles,
  Workflow,
  Scale,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { VIEW_DEFINITIONS, type ViewIcon } from '@/lib/views';

const SearchDialog = lazy(() =>
  import('@/components/search').then((mod) => ({
    default: mod.SearchDialog,
  }))
);

const VIEW_ICONS: Record<ViewIcon, LucideIcon> = {
  Activity,
  Archive,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Scale,
  ShieldAlert,
  Workflow,
};

function renderViewIcon(icon: ViewIcon) {
  const Icon = VIEW_ICONS[icon];
  return <Icon className="h-4 w-4" />;
}

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
  keywords?: readonly string[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMounted, setSearchMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { openCreateDialog, isHelpOpen } = useKeyboard();
  const { setView, navigateToTask } = useView();
  const { theme, setTheme } = useTheme();

  const openSearchDialog = useCallback(() => {
    setSearchMounted(true);
    setSearchOpen(true);
  }, []);

  const commands: CommandItem[] = useMemo(
    () => [
      // Actions
      {
        id: 'new-task',
        label: 'New Task',
        shortcut: 'C',
        icon: <Plus className="h-4 w-4" />,
        category: 'Actions',
        action: () => openCreateDialog(),
        keywords: ['create', 'add', 'task'],
      },
      {
        id: 'toggle-theme',
        label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        icon: theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
        category: 'Actions',
        action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
        keywords: ['theme', 'dark', 'light', 'mode', 'appearance'],
      },
      {
        id: 'open-search',
        label: 'Search Tasks and Docs',
        icon: <Sparkles className="h-4 w-4" />,
        category: 'Actions',
        action: openSearchDialog,
        keywords: ['qmd', 'semantic', 'retrieval', 'docs', 'archive'],
      },

      ...VIEW_DEFINITIONS.map((definition) => ({
        id: `go-${definition.view}`,
        label: definition.commandLabel,
        shortcut: definition.view === 'board' ? 'B' : undefined,
        icon: renderViewIcon(definition.icon),
        category: 'Navigation',
        action: () => setView(definition.view),
        keywords: definition.keywords,
      })),

      // Board shortcuts
      {
        id: 'move-todo',
        label: 'Move Task → To Do',
        shortcut: '1',
        icon: <ArrowRight className="h-4 w-4" />,
        category: 'Board',
        action: () => {},
        keywords: ['status', 'move'],
      },
      {
        id: 'move-inprogress',
        label: 'Move Task → In Progress',
        shortcut: '2',
        icon: <ArrowRight className="h-4 w-4" />,
        category: 'Board',
        action: () => {},
        keywords: ['status', 'move'],
      },
      {
        id: 'move-blocked',
        label: 'Move Task → Blocked',
        shortcut: '3',
        icon: <ArrowRight className="h-4 w-4" />,
        category: 'Board',
        action: () => {},
        keywords: ['status', 'move'],
      },
      {
        id: 'move-done',
        label: 'Move Task → Done',
        shortcut: '4',
        icon: <ArrowRight className="h-4 w-4" />,
        category: 'Board',
        action: () => {},
        keywords: ['status', 'move', 'complete'],
      },
      {
        id: 'nav-up',
        label: 'Select Previous Task',
        shortcut: 'K / ↑',
        icon: <Keyboard className="h-4 w-4" />,
        category: 'Board',
        action: () => {},
        keywords: ['navigate', 'up'],
      },
      {
        id: 'nav-down',
        label: 'Select Next Task',
        shortcut: 'J / ↓',
        icon: <Keyboard className="h-4 w-4" />,
        category: 'Board',
        action: () => {},
        keywords: ['navigate', 'down'],
      },
      {
        id: 'open-task',
        label: 'Open Selected Task',
        shortcut: 'Enter',
        icon: <Keyboard className="h-4 w-4" />,
        category: 'Board',
        action: () => {},
        keywords: ['view', 'detail'],
      },
    ],
    [openCreateDialog, openSearchDialog, setView, theme, setTheme]
  );

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.keywords?.some((k) => k.includes(q))
    );
  }, [commands, query]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: CommandItem[] }[] = [];
    const seen = new Set<string>();
    for (const cmd of filtered) {
      if (!seen.has(cmd.category)) {
        seen.add(cmd.category);
        groups.push({ category: cmd.category, items: [] });
      }
      const group = groups.find((g) => g.category === cmd.category);
      if (group) {
        group.items.push(cmd);
      }
    }
    return groups;
  }, [filtered]);

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // ⌘K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const runCommand = useCallback((cmd: CommandItem) => {
    setOpen(false);
    // Small delay so dialog closes before action fires
    setTimeout(() => cmd.action(), 50);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      runCommand(filtered[selectedIndex]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Don't show if help dialog is open
  if (isHelpOpen) return null;

  let flatIndex = -1;

  return (
    <>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        size={520}
        padding={0}
        title={<span className="sr-only">Command palette</span>}
        withCloseButton={false}
        classNames={{ content: 'overflow-hidden', header: 'sr-only', body: 'p-0' }}
      >
        <Box onKeyDown={handleKeyDown}>
          <Text component="p" className="sr-only">
            Search and run board actions, navigation commands, and shortcuts.
          </Text>

          <Group gap="sm" px="md" className="border-b" wrap="nowrap">
            <TextInput
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Type a command or search..."
              aria-label="Search commands"
              variant="unstyled"
              leftSection={<Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              className="min-w-0 flex-1"
              classNames={{
                input: 'h-12 bg-transparent text-sm placeholder:text-muted-foreground',
              }}
            />
            <Kbd className="hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              ESC
            </Kbd>
          </Group>

          <ScrollArea viewportRef={listRef} mah={320} p="xs">
            {filtered.length === 0 ? (
              <Text ta="center" py="xl" size="sm" c="dimmed">
                No commands found
              </Text>
            ) : (
              grouped.map((group) => (
                <Box key={group.category}>
                  <Text
                    px="xs"
                    py={6}
                    size="xs"
                    fw={600}
                    c="dimmed"
                    tt="uppercase"
                    className="tracking-wider"
                  >
                    {group.category}
                  </Text>
                  <Stack gap={2}>
                    {group.items.map((cmd) => {
                      flatIndex++;
                      const idx = flatIndex;
                      return (
                        <UnstyledButton
                          key={cmd.id}
                          data-index={idx}
                          className={cn(
                            'flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors',
                            idx === selectedIndex
                              ? 'bg-primary/10 text-primary'
                              : 'text-foreground hover:bg-muted/50'
                          )}
                          onClick={() => runCommand(cmd)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <span
                            className={cn(
                              'shrink-0',
                              idx === selectedIndex ? 'text-primary' : 'text-muted-foreground'
                            )}
                          >
                            {cmd.icon}
                          </span>
                          <span className="flex-1 text-left">{cmd.label}</span>
                          {cmd.shortcut && (
                            <Kbd className="ml-auto hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
                              {cmd.shortcut}
                            </Kbd>
                          )}
                        </UnstyledButton>
                      );
                    })}
                  </Stack>
                </Box>
              ))
            )}
          </ScrollArea>
        </Box>
      </Modal>
      {searchMounted && (
        <Suspense fallback={null}>
          <SearchDialog
            open={searchOpen}
            onOpenChange={setSearchOpen}
            onTaskOpen={navigateToTask}
          />
        </Suspense>
      )}
    </>
  );
}
