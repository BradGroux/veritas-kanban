import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

export type AppView =
  | 'board'
  | 'activity'
  | 'backlog'
  | 'archive'
  | 'templates'
  | 'workflows'
  | 'drift';

interface ViewContextValue {
  view: AppView;
  setView: (view: AppView) => void;
  /** Navigate to a specific task by opening the board and setting selectedTaskId. */
  navigateToTask: (taskId: string) => void;
  /** The task ID requested by view navigation (consumed once by the board). */
  pendingTaskId: string | null;
  clearPendingTask: () => void;
}

const BASE_PATH = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

const ViewContext = createContext<ViewContextValue>({
  view: 'board',
  setView: () => {},
  navigateToTask: () => {},
  pendingTaskId: null,
  clearPendingTask: () => {},
});

function pathToView(pathname: string): AppView {
  const stripped =
    BASE_PATH && pathname.startsWith(BASE_PATH)
      ? pathname.slice(BASE_PATH.length) || '/'
      : pathname;
  if (stripped === '/activity') return 'activity';
  if (stripped === '/backlog') return 'backlog';
  if (stripped === '/archive') return 'archive';
  if (stripped === '/templates') return 'templates';
  if (stripped === '/workflows') return 'workflows';
  if (stripped === '/drift') return 'drift';
  return 'board';
}

function viewToPath(view: AppView): string {
  const localPath = view === 'board' ? '/' : `/${view}`;
  return `${BASE_PATH}${localPath}` || '/';
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<AppView>(() => pathToView(window.location.pathname));
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const setView = useCallback((nextView: AppView) => {
    setViewState(nextView);
    const nextPath = viewToPath(nextView);
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, '', nextPath);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setViewState(pathToView(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToTask = useCallback(
    (taskId: string) => {
      setPendingTaskId(taskId);
      setView('board');
    },
    [setView]
  );

  const clearPendingTask = useCallback(() => {
    setPendingTaskId(null);
  }, []);

  const value = useMemo(
    () => ({ view: viewState, setView, navigateToTask, pendingTaskId, clearPendingTask }),
    [viewState, setView, navigateToTask, pendingTaskId, clearPendingTask]
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView() {
  return useContext(ViewContext);
}
