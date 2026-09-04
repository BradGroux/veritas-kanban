import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { Box, Group, Kbd, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useView } from '@/contexts/ViewContext';
import {
  Plus,
  Clock,
  ClipboardList,
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
import {
  createCommandRegistry,
  type CommandDescriptor,
  type CommandIcon,
} from '@/lib/command-registry';
import type { ViewIcon } from '@/lib/views';
import { OverlayFooter, UiModal as Modal, useOverlayHandoff } from '@/components/ui/UiOverlay';

const SearchDialog = lazy(() =>
  import('@/components/search').then((mod) => ({
    default: mod.SearchDialog,
  }))
);

const VIEW_ICONS: Record<ViewIcon, LucideIcon> = {
  Activity,
  Archive,
  Clock,
  ClipboardList,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Scale,
  ShieldAlert,
  Workflow,
};

const COMMAND_ICONS: Record<CommandIcon, LucideIcon> = {
  ...VIEW_ICONS,
  ArrowRight,
  Keyboard,
  Moon,
  Plus,
  Sparkles,
  Sun,
};

function renderCommandIcon(icon: CommandIcon) {
  const Icon = COMMAND_ICONS[icon];
  return <Icon className="h-4 w-4" />;
}

interface CommandItem extends CommandDescriptor {
  iconNode: ReactNode;
}

function firstEnabledIndex(commands: readonly CommandItem[]): number {
  return commands.findIndex((command) => !command.disabledReason);
}

function nextEnabledIndex(
  commands: readonly CommandItem[],
  selectedIndex: number,
  direction: 1 | -1
): number {
  if (commands.length === 0) return -1;

  let index = selectedIndex;
  for (let visited = 0; visited < commands.length; visited++) {
    index = (index + direction + commands.length) % commands.length;
    if (!commands[index]?.disabledReason) return index;
  }

  return -1;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMounted, setSearchMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { openCreateDialog, isHelpOpen } = useKeyboard();
  const { setView, navigateToTask } = useView();
  const { theme, setTheme } = useTheme();

  const openSearchDialog = useCallback(() => {
    setSearchMounted(true);
    setSearchOpen(true);
  }, []);

  const executeCommand = useCallback(
    (cmd: CommandDescriptor) => {
      switch (cmd.action.type) {
        case 'open-create-task':
          openCreateDialog();
          return;
        case 'toggle-theme':
          setTheme(theme === 'dark' ? 'light' : 'dark');
          return;
        case 'open-search':
          openSearchDialog();
          return;
        case 'open-settings':
          window.dispatchEvent(
            new CustomEvent('veritas:open-settings', { detail: { section: cmd.action.section } })
          );
          return;
        case 'open-diagnostics':
          window.dispatchEvent(new CustomEvent('veritas:open-diagnostics'));
          return;
        case 'navigate-view':
          setView(cmd.action.view);
          return;
        case 'board-shortcut':
          return;
      }
    },
    [openCreateDialog, openSearchDialog, setTheme, setView, theme]
  );

  const commands: CommandItem[] = useMemo(
    () =>
      createCommandRegistry({ theme }).map((command) => ({
        ...command,
        iconNode: renderCommandIcon(command.icon),
      })),
    [theme]
  );

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.keywords?.some((keyword) => keyword.toLowerCase().includes(q)) ||
        cmd.aliases?.some((alias) => alias.toLowerCase().includes(q))
    );
  }, [commands, query]);

  const visibleCommands = useMemo(
    () => (query.trim() ? filtered : filtered.filter((command) => !command.disabledReason)),
    [filtered, query]
  );

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: CommandItem[] }[] = [];
    const seen = new Set<string>();
    for (const cmd of visibleCommands) {
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
  }, [visibleCommands]);

  const orderedCommands = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);
  const unavailableCount = commands.filter((command) => command.disabledReason).length;
  const availableCount = commands.length - unavailableCount;
  const selectedCommand = orderedCommands[selectedIndex];

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Keep selection on an executable command after filtering or registry changes.
  useEffect(() => {
    if (
      selectedIndex < 0 ||
      selectedIndex >= orderedCommands.length ||
      orderedCommands[selectedIndex]?.disabledReason
    ) {
      setSelectedIndex(firstEnabledIndex(orderedCommands));
    }
  }, [orderedCommands, selectedIndex]);

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

  const handoff = useOverlayHandoff(open, executeCommand);
  const runCommand = (cmd: CommandItem) => {
    if (cmd.disabledReason) return;
    handoff.queue(cmd);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((index) => nextEnabledIndex(orderedCommands, index, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((index) => nextEnabledIndex(orderedCommands, index, -1));
    } else if (e.key === 'Enter' && orderedCommands[selectedIndex]) {
      e.preventDefault();
      runCommand(orderedCommands[selectedIndex]);
    }
  };

  const updateScrollCues = useCallback(() => {
    const viewport = listRef.current;
    if (!viewport) return;

    const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    setCanScrollUp(viewport.scrollTop > 1);
    setCanScrollDown(remaining > 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updateScrollCues);
    window.addEventListener('resize', updateScrollCues);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateScrollCues);
    };
  }, [open, orderedCommands, updateScrollCues]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    updateScrollCues();
  }, [selectedIndex, updateScrollCues]);

  // Don't show if help dialog is open
  if (isHelpOpen) return null;

  let flatIndex = -1;

  return (
    <>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        variant="form"
        compound
        title="Command palette"
        onExitTransitionEnd={handoff.onExitTransitionEnd}
      >
        <Box
          onKeyDown={handleKeyDown}
          className="flex min-h-0 flex-1 flex-col"
          style={{ height: '34rem' }}
          data-testid="command-palette-surface"
        >
          <Text component="p" className="sr-only">
            Search and run board actions, navigation commands, and shortcuts.
          </Text>

          <Box className="shrink-0 border-b bg-muted/15 p-[var(--vk-overlay-inset)]">
            <TextInput
              ref={inputRef}
              data-autofocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Type a command or search..."
              aria-label="Search commands"
              aria-activedescendant={
                orderedCommands[selectedIndex]
                  ? `command-${orderedCommands[selectedIndex].id}`
                  : undefined
              }
              variant="filled"
              leftSection={<Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              className="min-w-0"
              classNames={{
                input:
                  'h-11 border border-border bg-background text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary',
              }}
            />
          </Box>

          {selectedCommand && (
            <Group
              justify="space-between"
              gap="sm"
              px="md"
              py={8}
              wrap="wrap"
              className="shrink-0 border-b bg-primary/5"
              data-testid="active-command-summary"
            >
              <Group gap="xs" wrap="nowrap" className="min-w-0">
                <Text size="xs" fw={700} c="primary" tt="uppercase" className="tracking-wider">
                  Ready
                </Text>
                <Text size="sm" fw={600} truncate>
                  {selectedCommand.label}
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap" className="shrink-0">
                <Text size="xs" c="dimmed">
                  {selectedCommand.category}
                </Text>
                <Kbd className="hidden sm:inline-flex">Enter</Kbd>
              </Group>
            </Group>
          )}

          <div
            ref={listRef}
            className="vk-overlay-scroll"
            aria-label="Available commands"
            onScroll={updateScrollCues}
          >
            {visibleCommands.length === 0 ? (
              <Text ta="center" py="xl" size="sm" c="dimmed">
                No commands found
              </Text>
            ) : (
              grouped.map((group) => (
                <Box key={group.category} pb={4}>
                  <Group justify="space-between" gap="xs" px="xs" py={6} wrap="nowrap">
                    <Text
                      size="xs"
                      fw={700}
                      c="dimmed"
                      tt="uppercase"
                      className="tracking-[0.12em]"
                    >
                      {group.category}
                    </Text>
                    <Text size="xs" c="dimmed" aria-hidden="true">
                      {group.items.length}
                    </Text>
                  </Group>
                  <Stack gap={2}>
                    {group.items.map((cmd) => {
                      flatIndex++;
                      const idx = flatIndex;
                      const isSelected = idx === selectedIndex;
                      const disabledDescriptionId = cmd.disabledReason
                        ? `command-disabled-${cmd.id}`
                        : undefined;
                      return (
                        <UnstyledButton
                          key={cmd.id}
                          px="sm"
                          py="xs"
                          id={`command-${cmd.id}`}
                          data-index={idx}
                          data-command-id={cmd.id}
                          data-selected={isSelected || undefined}
                          aria-disabled={Boolean(cmd.disabledReason)}
                          aria-describedby={disabledDescriptionId}
                          className={cn(
                            'flex min-h-11 w-full items-center gap-3 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                            cmd.disabledReason
                              ? 'cursor-not-allowed border border-dashed border-border/70 bg-muted/15 text-muted-foreground'
                              : isSelected
                                ? 'bg-primary text-white shadow-sm'
                                : 'text-foreground hover:bg-muted/50'
                          )}
                          style={
                            isSelected && !cmd.disabledReason
                              ? { backgroundColor: 'var(--primary)', color: 'white' }
                              : undefined
                          }
                          onClick={() => runCommand(cmd)}
                          onFocus={() => !cmd.disabledReason && setSelectedIndex(idx)}
                          onMouseEnter={() => !cmd.disabledReason && setSelectedIndex(idx)}
                        >
                          <span
                            className={cn(
                              'shrink-0',
                              isSelected ? 'text-white' : 'text-muted-foreground'
                            )}
                          >
                            {cmd.iconNode}
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block">{cmd.label}</span>
                            {cmd.disabledReason && (
                              <span
                                id={disabledDescriptionId}
                                className="mt-0.5 block text-[11px] leading-4 text-muted-foreground/80"
                              >
                                {cmd.disabledReason}
                              </span>
                            )}
                          </span>
                          {cmd.shortcut && (
                            <Kbd
                              className={cn(
                                'ml-auto hidden h-5 shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[10px] sm:inline-flex',
                                isSelected
                                  ? 'border-white/30 bg-white/15 text-white'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
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
          </div>

          <OverlayFooter wrap="wrap" className="!justify-between">
            <Text size="xs" c="dimmed">
              {query.trim()
                ? `${visibleCommands.length} result${visibleCommands.length === 1 ? '' : 's'}`
                : `${availableCount} ready · ${unavailableCount} unavailable`}
            </Text>
            <Text size="xs" c="dimmed" aria-live="polite">
              {canScrollUp && canScrollDown
                ? 'More above and below'
                : canScrollUp
                  ? 'More commands above'
                  : canScrollDown
                    ? 'More commands below'
                    : 'All commands visible'}
            </Text>
            <Group gap={6} wrap="nowrap" className="hidden sm:flex">
              <Kbd>↑↓</Kbd>
              <Text size="xs" c="dimmed">
                Navigate
              </Text>
              <Kbd>Enter</Kbd>
              <Text size="xs" c="dimmed">
                Run
              </Text>
            </Group>
          </OverlayFooter>
        </Box>
      </Modal>
      {searchMounted && (
        <Suspense fallback={null}>
          <SearchDialog
            open={searchOpen}
            onOpenChange={setSearchOpen}
            onTaskOpen={navigateToTask}
            onViewOpen={setView}
          />
        </Suspense>
      )}
    </>
  );
}
