import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Task, TaskStatus } from '@veritas-kanban/shared';

interface KeyboardContextValue {
  // Dialog triggers
  openCreateDialog: () => void;
  setOpenCreateDialog: (fn: () => void) => void;
  openHelpDialog: () => void;
  closeHelpDialog: () => void;
  isHelpOpen: boolean;
  
  // Task selection
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  
  // Task list for navigation
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  
  // Callbacks
  onOpenTask: ((task: Task) => void) | null;
  setOnOpenTask: (fn: (task: Task) => void) => void;
  onMoveTask: ((taskId: string, status: TaskStatus) => void) | null;
  setOnMoveTask: (fn: (taskId: string, status: TaskStatus) => void) => void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

const STATUS_MAP: Record<string, TaskStatus> = {
  '1': 'todo',
  '2': 'in-progress',
  '3': 'review',
  '4': 'done',
};

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openCreateDialogFn, setOpenCreateDialogFn] = useState<(() => void) | null>(null);
  const [onOpenTaskFn, setOnOpenTaskFn] = useState<((task: Task) => void) | null>(null);
  const [onMoveTaskFn, setOnMoveTaskFn] = useState<((taskId: string, status: TaskStatus) => void) | null>(null);

  const openCreateDialog = useCallback(() => {
    openCreateDialogFn?.();
  }, [openCreateDialogFn]);

  const openHelpDialog = useCallback(() => {
    setIsHelpOpen(true);
  }, []);

  const closeHelpDialog = useCallback(() => {
    setIsHelpOpen(false);
  }, []);

  // Get flat list of tasks sorted by column then position
  const getTaskList = useCallback(() => {
    const statusOrder: TaskStatus[] = ['todo', 'in-progress', 'review', 'done'];
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
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Ignore if a dialog is open (except Escape)
      const dialogOpen = document.querySelector('[role="dialog"]');
      if (dialogOpen && e.key !== 'Escape') {
        return;
      }

      const taskList = getTaskList();
      const currentIndex = selectedTaskId
        ? taskList.findIndex(t => t.id === selectedTaskId)
        : -1;

      switch (e.key) {
        case 'c':
          e.preventDefault();
          openCreateDialog();
          break;

        case '?':
          e.preventDefault();
          setIsHelpOpen(prev => !prev);
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
          if (selectedTaskId && onOpenTaskFn) {
            const task = taskList.find(t => t.id === selectedTaskId);
            if (task) {
              onOpenTaskFn(task);
            }
          }
          break;

        case '1':
        case '2':
        case '3':
        case '4':
          if (selectedTaskId && onMoveTaskFn) {
            e.preventDefault();
            const newStatus = STATUS_MAP[e.key];
            onMoveTaskFn(selectedTaskId, newStatus);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    getTaskList,
    selectedTaskId,
    isHelpOpen,
    openCreateDialog,
    onOpenTaskFn,
    onMoveTaskFn,
  ]);

  const value: KeyboardContextValue = {
    openCreateDialog,
    setOpenCreateDialog: (fn) => setOpenCreateDialogFn(() => fn),
    openHelpDialog,
    closeHelpDialog,
    isHelpOpen,
    selectedTaskId,
    setSelectedTaskId,
    tasks,
    setTasks,
    onOpenTask: onOpenTaskFn,
    setOnOpenTask: (fn) => setOnOpenTaskFn(() => fn),
    onMoveTask: onMoveTaskFn,
    setOnMoveTask: (fn) => setOnMoveTaskFn(() => fn),
  };

  return (
    <KeyboardContext.Provider value={value}>
      {children}
    </KeyboardContext.Provider>
  );
}

export function useKeyboard() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboard must be used within KeyboardProvider');
  }
  return context;
}
