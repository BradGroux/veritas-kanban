import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';

export type AppView =
  | 'board'
  | 'activity'
  | 'backlog'
  | 'archive'
  | 'templates'
  | 'workflows'
  | 'scoring';

const VIEW_PATHS: Record<AppView, string> = {
  board: '/',
  activity: '/activity',
  backlog: '/backlog',
  archive: '/archive',
  templates: '/templates',
  workflows: '/workflows',
  scoring: '/scoring',
};

function getBasePath() {
  return (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
}

function normalizePath(pathname: string) {
  const base = getBasePath();
  if (base && pathname.startsWith(base)) {
    return pathname.slice(base.length) || '/';
  }
  return pathname || '/';
}

function viewFromPathname(pathname: string): AppView {
  const normalized = normalizePath(pathname);
  const match = Object.entries(VIEW_PATHS).find(([, path]) => path === normalized);
  return (match?.[0] as AppView | undefined) || 'board';
}

function syncBrowserPath(view: AppView) {
  if (typeof window === 'undefined') return;
  const base = getBasePath();
  const targetPath = `${base}${VIEW_PATHS[view] === '/' ? '' : VIEW_PATHS[view]}` || '/';
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== targetPath) {
    window.history.pushState({}, '', targetPath);
  }
}

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
  const [view, setViewState] = useState<AppView>(() =>
    typeof window === 'undefined' ? 'board' : viewFromPathname(window.location.pathname)
  );
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const setView = useCallback((nextView: AppView) => {
    setViewState(nextView);
    syncBrowserPath(nextView);
  }, []);

  const navigateToTask = useCallback(
    (taskId: string) => {
      setPendingTaskId(taskId);
      setViewState('board');
      syncBrowserPath('board');
    },
    [setViewState]
  );

  const clearPendingTask = useCallback(() => {
    setPendingTaskId(null);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setViewState(viewFromPathname(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const value = useMemo(
    () => ({ view, setView, navigateToTask, pendingTaskId, clearPendingTask }),
    [view, setView, navigateToTask, pendingTaskId, clearPendingTask]
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView() {
  return useContext(ViewContext);
}
