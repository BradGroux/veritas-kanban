import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useView } from '@/contexts/ViewContext';
import {
  Plus,
  LayoutDashboard,
  ListOrdered,
  Inbox,
  Archive,
  Search,
  ArrowRight,
  Moon,
  Sun,
  Keyboard,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
  keywords?: string[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { openCreateDialog, isHelpOpen } = useKeyboard();
  const { setView } = useView();
  const { theme, setTheme } = useTheme();

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

      // Navigation
      {
        id: 'go-board',
        label: 'Go to Board',
        shortcut: 'B',
        icon: <LayoutDashboard className="h-4 w-4" />,
        category: 'Navigation',
        action: () => setView('board'),
        keywords: ['kanban', 'home', 'main'],
      },
      {
        id: 'go-activity',
        label: 'Go to Activity',
        icon: <ListOrdered className="h-4 w-4" />,
        category: 'Navigation',
        action: () => setView('activity'),
        keywords: ['feed', 'log', 'history'],
      },
      {
        id: 'go-backlog',
        label: 'Go to Backlog',
        icon: <Inbox className="h-4 w-4" />,
        category: 'Navigation',
        action: () => setView('backlog'),
        keywords: ['someday', 'maybe', 'later'],
      },
      {
        id: 'go-archive',
        label: 'Go to Archive',
        icon: <Archive className="h-4 w-4" />,
        category: 'Navigation',
        action: () => setView('archive'),
        keywords: ['done', 'completed', 'old'],
      },

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
    [openCreateDialog, setView, theme, setTheme]
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
      groups.find((g) => g.category === cmd.category)!.items.push(cmd);
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

  const runCommand = useCallback(
    (cmd: CommandItem) => {
      setOpen(false);
      // Small delay so dialog closes before action fires
      setTimeout(() => cmd.action(), 50);
    },
    []
  );

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[520px] p-0 gap-0 overflow-hidden" onKeyDown={handleKeyDown}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search..."
            className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No commands found
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category}>
                <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {group.category}
                </div>
                {group.items.map((cmd) => {
                  flatIndex++;
                  const idx = flatIndex;
                  return (
                    <button
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
                      <span className={cn(
                        'shrink-0',
                        idx === selectedIndex ? 'text-primary' : 'text-muted-foreground'
                      )}>
                        {cmd.icon}
                      </span>
                      <span className="flex-1 text-left">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="ml-auto hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
