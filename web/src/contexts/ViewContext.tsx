import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';
import { VIEW_PATHS, type AppView } from '@/lib/views';
import type { TaskDetailNavigationTarget } from '@/components/task/TaskDetailPanel';

const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const NAVIGATION_STATE_KEY = 'veritasKanbanNavigation';

interface NavigationHistoryState {
  view: AppView;
  originView: AppView | null;
  scrollTop: number;
}

function getNavigationHistoryState(): NavigationHistoryState | null {
  if (typeof window === 'undefined') return null;
  const state = window.history.state;
  if (!state || typeof state !== 'object') return null;
  const navigation = (state as Record<string, unknown>)[NAVIGATION_STATE_KEY];
  if (!navigation || typeof navigation !== 'object') return null;
  const candidate = navigation as Partial<NavigationHistoryState>;
  if (!candidate.view || !(candidate.view in VIEW_PATHS)) return null;
  return {
    view: candidate.view,
    originView:
      candidate.originView && candidate.originView in VIEW_PATHS ? candidate.originView : null,
    scrollTop: typeof candidate.scrollTop === 'number' ? candidate.scrollTop : 0,
  };
}

function historyStateWithNavigation(
  navigation: NavigationHistoryState,
  preserveTransientState = true
): Record<string, unknown> {
  const currentState =
    window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
  const nextState: Record<string, unknown> = {
    ...currentState,
    [NAVIGATION_STATE_KEY]: navigation,
  };
  if (!preserveTransientState) {
    delete nextState.veritasTaskDetail;
    delete nextState.veritasTaskWorkflow;
  }
  return nextState;
}

function getMainScrollTop(): number {
  return document.getElementById('main-content')?.scrollTop ?? 0;
}

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
  navigateToTask: (taskId: string, target?: TaskDetailNavigationTarget) => void;
  /** The task ID requested by view navigation (consumed once by the board). */
  pendingTaskId: string | null;
  /** Optional tab/run target for the pending task navigation. */
  pendingTaskTarget: TaskDetailNavigationTarget | null;
  clearPendingTask: () => void;
  /** Return to the actual in-app history origin, or replace a direct link with Board. */
  goBack: () => void;
  /** Return from a task opened by another full-page view. No-op for Board-owned tasks. */
  returnFromTask: () => void;
}

const ViewContext = createContext<ViewContextValue>({
  view: 'board',
  setView: () => {},
  navigateToTask: () => {},
  pendingTaskId: null,
  pendingTaskTarget: null,
  clearPendingTask: () => {},
  goBack: () => {},
  returnFromTask: () => {},
});

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<AppView>(() => getViewFromLocation());
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [pendingTaskTarget, setPendingTaskTarget] = useState<TaskDetailNavigationTarget | null>(
    null
  );
  const [taskOriginView, setTaskOriginView] = useState<AppView | null>(null);

  const setView = useCallback(
    (nextView: AppView) => {
      setTaskOriginView(null);

      if (typeof window !== 'undefined') {
        const currentNavigation = getNavigationHistoryState();
        if (currentNavigation) {
          window.history.replaceState(
            historyStateWithNavigation({
              ...currentNavigation,
              view,
              scrollTop: getMainScrollTop(),
            }),
            '',
            `${window.location.pathname}${window.location.search}${window.location.hash}`
          );
        }

        const nextPath = `${basePath}${VIEW_PATHS[nextView]}`.replace(/\/+/g, '/');
        const nextUrl = nextView === 'board' ? `${nextPath}${window.location.search}` : nextPath;
        const currentPath = `${window.location.pathname}${window.location.search}`;
        if (currentPath !== nextUrl) {
          window.history.pushState(
            historyStateWithNavigation(
              {
                view: nextView,
                originView: view,
                scrollTop: 0,
              },
              false
            ),
            '',
            nextUrl
          );
        }
      }

      setViewState(nextView);
    },
    [view]
  );

  const goBack = useCallback(() => {
    if (typeof window === 'undefined') return;
    const navigation = getNavigationHistoryState();
    if (navigation?.originView) {
      window.history.back();
      return;
    }

    const boardPath = `${basePath}${VIEW_PATHS.board}`.replace(/\/+/g, '/');
    window.history.replaceState(
      historyStateWithNavigation(
        {
          view: 'board',
          originView: null,
          scrollTop: 0,
        },
        false
      ),
      '',
      boardPath
    );
    setViewState('board');
    setTaskOriginView(null);
  }, []);

  const navigateToTask = useCallback(
    (taskId: string, target?: TaskDetailNavigationTarget) => {
      const originView = view === 'board' ? null : view;
      setPendingTaskId(taskId);
      setPendingTaskTarget(target ?? null);
      setView('board');
      setTaskOriginView(originView);
    },
    [setView, view]
  );

  const clearPendingTask = useCallback(() => {
    setPendingTaskId(null);
    setPendingTaskTarget(null);
  }, []);

  const returnFromTask = useCallback(() => {
    if (!taskOriginView) return;
    setTaskOriginView(null);
    goBack();
  }, [goBack, taskOriginView]);

  const value = useMemo(
    () => ({
      view,
      setView,
      navigateToTask,
      pendingTaskId,
      pendingTaskTarget,
      clearPendingTask,
      goBack,
      returnFromTask,
    }),
    [
      view,
      setView,
      navigateToTask,
      pendingTaskId,
      pendingTaskTarget,
      clearPendingTask,
      goBack,
      returnFromTask,
    ]
  );

  useEffect(() => {
    if (!getNavigationHistoryState()) {
      window.history.replaceState(
        historyStateWithNavigation(
          {
            view: getViewFromLocation(),
            originView: null,
            scrollTop: getMainScrollTop(),
          },
          false
        ),
        '',
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPendingTaskId(null);
      setPendingTaskTarget(null);
      setTaskOriginView(null);
      setViewState(getViewFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const main = document.getElementById('main-content');
    if (!main) return;
    const navigation = getNavigationHistoryState();
    let restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = window.requestAnimationFrame(() => {
        if (navigation?.view === view) {
          main.scrollTop = navigation.scrollTop;
        }
      });
    });
    let persistFrame: number | null = null;
    const persistScroll = () => {
      if (persistFrame !== null) window.cancelAnimationFrame(persistFrame);
      persistFrame = window.requestAnimationFrame(() => {
        const currentNavigation = getNavigationHistoryState();
        if (!currentNavigation || currentNavigation.view !== view) return;
        window.history.replaceState(
          historyStateWithNavigation({
            ...currentNavigation,
            scrollTop: main.scrollTop,
          }),
          '',
          `${window.location.pathname}${window.location.search}${window.location.hash}`
        );
      });
    };
    main.addEventListener('scroll', persistScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', persistScroll);
      window.cancelAnimationFrame(restoreFrame);
      if (persistFrame !== null) window.cancelAnimationFrame(persistFrame);
    };
  }, [view]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && !event.ctrlKey && event.key === '[') {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [goBack]);

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView() {
  return useContext(ViewContext);
}
