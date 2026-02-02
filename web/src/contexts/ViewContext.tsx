import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export type AppView = 'board' | 'activity' | 'backlog' | 'archive';

interface ViewContextValue {
  view: AppView;
  setView: (view: AppView) => void;
  /** Navigate to a specific task by opening the board and setting selectedTaskId. */
  navigateToTask: (taskId: string) => void;
  /** The task ID requested by view navigation (consumed once by the board). */
  pendingTaskId: string | null;
  clearPendingTask: () => void;
}

const ViewContext = createContext<ViewContextValue>({
  view: 'board',
  setView: () => {},
  navigateToTask: () => {},
  pendingTaskId: null,
  clearPendingTask: () => {},
});

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('board');
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const navigateToTask = useCallback((taskId: string) => {
    setPendingTaskId(taskId);
    setView('board');
  }, []);

  const clearPendingTask = useCallback(() => {
    setPendingTaskId(null);
  }, []);

  const value = useMemo(
    () => ({ view, setView, navigateToTask, pendingTaskId, clearPendingTask }),
    [view, navigateToTask, pendingTaskId, clearPendingTask]
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView() {
  return useContext(ViewContext);
}
