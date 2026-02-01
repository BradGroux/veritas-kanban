import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import type { Task, TaskStatus } from '@veritas-kanban/shared';
import { toast } from './useToast';

interface KeyboardContextValue {
  // Dialog triggers
  openCreateDialog: () => void;
  setOpenCreateDialog: (fn: () => void) => void;
  openHelpDialog: () => void;
  closeHelpDialog: () => void;
  isHelpOpen: boolean;

  // Chat panel
  openChatPanel: () => void;
  setOpenChatPanel: (fn: () => void) => void;

  // Task selection
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;

  // Task list for navigation
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;

  // Callbacks (using refs to avoid re-render loops)
  setOnOpenTask: (fn: (task: Task) => void) => void;
  setOnMoveTask: (fn: (taskId: string, status: TaskStatus) => void) => void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

const STATUS_MAP: Record<string, TaskStatus> = {
  '1': 'todo',
  '2': 'planning',
  '3': 'in-progress',
  '4': 'blocked',
  '5': 'done',
};

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Use refs for callbacks to avoid re-render loops
  const openCreateDialogRef = useRef<(() => void) | null>(null);
  const openChatPanelRef = useRef<(() => void) | null>(null);
  const onOpenTaskRef = useRef<((task: Task) => void) | null>(null);
  const onMoveTaskRef = useRef<((taskId: string, status: TaskStatus) => void) | null>(null);

  const openCreateDialog = useCallback(() => {
    openCreateDialogRef.current?.();
  }, []);

  const setOpenCreateDialog = useCallback((fn: () => void) => {
    openCreateDialogRef.current = fn;
  }, []);

  const openChatPanel = useCallback(() => {
    openChatPanelRef.current?.();
  }, []);

  const setOpenChatPanel = useCallback((fn: () => void) => {
    openChatPanelRef.current = fn;
  }, []);

  const openHelpDialog = useCallback(() => {
    setIsHelpOpen(true);
  }, []);

  const closeHelpDialog = useCallback(() => {
    setIsHelpOpen(false);
  }, []);

  const setOnOpenTask = useCallback((fn: (task: Task) => void) => {
    onOpenTaskRef.current = fn;
  }, []);

  const setOnMoveTask = useCallback((fn: (taskId: string, status: TaskStatus) => void) => {
    onMoveTaskRef.current = fn;
  }, []);

  // Get flat list of tasks sorted by column then position
  const getTaskList = useCallback(() => {
    const statusOrder: TaskStatus[] = ['todo', 'planning', 'in-progress', 'blocked', 'done'];
    return [...tasks].sort((a, b) => {
      const aIndex = statusOrder.indexOf(a.status);
      const bIndex = statusOrder.indexOf(b.status);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.title.localeCompare(b.title);
    });
  }, [tasks]);

  // Keyboard event handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ignore if a dialog is open (except Escape)
      // Check for visible dialogs only (shadcn uses data-state attribute)
      const dialogOpen = document.querySelector('[role="dialog"][data-state="open"]');
      if (dialogOpen && e.key !== 'Escape') {
        return;
      }

      const taskList = getTaskList();
      const currentIndex = selectedTaskId ? taskList.findIndex((t) => t.id === selectedTaskId) : -1;

      // Cmd+Shift+C (or Ctrl+Shift+C on Windows/Linux) - Toggle chat panel
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        openChatPanel();
        return;
      }

      switch (e.key) {
        case 'c':
          e.preventDefault();
          openCreateDialog();
          break;

        case '?':
          e.preventDefault();
          setIsHelpOpen((prev) => !prev);
          break;

        case 'Escape':
          e.preventDefault();
          if (isHelpOpen) {
            setIsHelpOpen(false);
          } else {
            setSelectedTaskId(null);
          }
          break;

        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          if (taskList.length > 0) {
            const nextIndex = currentIndex < taskList.length - 1 ? currentIndex + 1 : 0;
            setSelectedTaskId(taskList[nextIndex].id);
          }
          break;

        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          if (taskList.length > 0) {
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : taskList.length - 1;
            setSelectedTaskId(taskList[prevIndex].id);
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedTaskId && onOpenTaskRef.current) {
            const task = taskList.find((t) => t.id === selectedTaskId);
            if (task) {
              onOpenTaskRef.current(task);
            }
          }
          break;

        case '1':
        case '2':
        case '3':
        case '4':
          e.preventDefault();
          if (selectedTaskId && onMoveTaskRef.current) {
            const newStatus = STATUS_MAP[e.key];
            onMoveTaskRef.current(selectedTaskId, newStatus);
          } else {
            // Show toast when no task is selected
            toast({
              title: 'No task selected',
              description: 'Use j/k or arrow keys to select a task first',
            });
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [getTaskList, selectedTaskId, isHelpOpen, openCreateDialog, openChatPanel]);

  const value = useMemo<KeyboardContextValue>(
    () => ({
      openCreateDialog,
      setOpenCreateDialog,
      openChatPanel,
      setOpenChatPanel,
      openHelpDialog,
      closeHelpDialog,
      isHelpOpen,
      selectedTaskId,
      setSelectedTaskId,
      tasks,
      setTasks,
      setOnOpenTask,
      setOnMoveTask,
    }),
    [
      openCreateDialog,
      setOpenCreateDialog,
      openChatPanel,
      setOpenChatPanel,
      openHelpDialog,
      closeHelpDialog,
      isHelpOpen,
      selectedTaskId,
      setSelectedTaskId,
      tasks,
      setTasks,
      setOnOpenTask,
      setOnMoveTask,
    ]
  );

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}

export function useKeyboard() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboard must be used within KeyboardProvider');
  }
  return context;
}
