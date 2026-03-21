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
  | 'policies'
  | 'drift'
  | 'decisions'
  | 'scoring';

const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

const VIEW_PATHS: Record<AppView, string> = {
  board: '/',
  activity: '/activity',
  backlog: '/backlog',
  archive: '/archive',
  templates: '/templates',
  workflows: '/workflows',
  policies: '/policies',
  drift: '/drift',
  decisions: '/decisions',
  scoring: '/scoring',
};

function normalizeAppPath(pathname: string): string {
  const normalized = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length) || '/'
    : pathname;
  return normalized === '' ? '/' : normalized.replace(/\/+$/, '') || '/';
}

function getViewFromLocation(): AppView {
  if (typeof window === 'undefined') return 'board';
  const path = normalizeAppPath(window.location.pathname);
  const entry = Object.entries(VIEW_PATHS).find(([, value]) => value === path);
  return (entry?.[0] as AppView | undefined) || 'board';
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
  const [view, setViewState] = useState<AppView>(() => getViewFromLocation());
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const setView = useCallback((nextView: AppView) => {
    setViewState(nextView);

    if (typeof window === 'undefined') return;

    const nextPath = `${basePath}${VIEW_PATHS[nextView]}`.replace(/\/+/g, '/');
    const nextUrl = nextView === 'board' ? `${nextPath}${window.location.search}` : nextPath;
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
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
    () => ({ view, setView, navigateToTask, pendingTaskId, clearPendingTask }),
    [view, setView, navigateToTask, pendingTaskId, clearPendingTask]
  );

  useEffect(() => {
    const handlePopState = () => {
      setViewState(getViewFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView() {
  return useContext(ViewContext);
}
