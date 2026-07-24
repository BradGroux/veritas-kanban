import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMediaQuery } from '@mantine/hooks';

export type DesktopBottomPanel = 'board-chat' | 'squad-chat';

interface DesktopShellContextValue {
  isDesktopClient: boolean;
  leftRailOpen: boolean;
  rightRailOpen: boolean;
  bottomPanel: DesktopBottomPanel | null;
  bottomPanelHeight: number;
  setLeftRailOpen: (open: boolean) => void;
  setRightRailOpen: (open: boolean) => void;
  setBottomPanelHeight: (height: number) => void;
  openBottomPanel: (panel: DesktopBottomPanel) => void;
  closeBottomPanel: () => void;
  toggleBottomPanel: (panel?: DesktopBottomPanel) => void;
}

const LEFT_RAIL_STORAGE_KEY = 'veritas.desktop.leftRailOpen';
const RIGHT_RAIL_STORAGE_KEY = 'veritas.desktop.rightRailOpen';
const BOTTOM_PANEL_STORAGE_KEY = 'veritas.desktop.bottomPanel';
const BOTTOM_PANEL_HEIGHT_STORAGE_KEY = 'veritas.workbench.bottomPanelHeight';
const BOTTOM_PANEL_HISTORY_STATE_KEY = 'veritasBottomPanel';
const BOTTOM_PANEL_VIEWPORT_RESERVE = 220;
const COMPACT_BOTTOM_PANEL_HEIGHT = 200;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 340;
export const MIN_BOTTOM_PANEL_HEIGHT = 320;
export const MAX_BOTTOM_PANEL_HEIGHT = 640;

const DEFAULT_CONTEXT: DesktopShellContextValue = {
  isDesktopClient: false,
  leftRailOpen: false,
  rightRailOpen: false,
  bottomPanel: null,
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
  setLeftRailOpen: () => undefined,
  setRightRailOpen: () => undefined,
  setBottomPanelHeight: () => undefined,
  openBottomPanel: () => undefined,
  closeBottomPanel: () => undefined,
  toggleBottomPanel: () => undefined,
};

const DesktopShellContext = createContext<DesktopShellContextValue>(DEFAULT_CONTEXT);

function isDesktopClient(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as Window & { veritasDesktop?: unknown }).veritasDesktop)
  );
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;

  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === 'true';
  } catch {
    return fallback;
  }
}

function clampBottomPanelHeight(height: number): number {
  const viewportMax =
    typeof window === 'undefined'
      ? MAX_BOTTOM_PANEL_HEIGHT
      : Math.min(
          MAX_BOTTOM_PANEL_HEIGHT,
          Math.max(COMPACT_BOTTOM_PANEL_HEIGHT, window.innerHeight - BOTTOM_PANEL_VIEWPORT_RESERVE)
        );
  const viewportMin = Math.min(MIN_BOTTOM_PANEL_HEIGHT, viewportMax);
  return Math.min(viewportMax, Math.max(viewportMin, height));
}

function readStoredBottomPanelHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_BOTTOM_PANEL_HEIGHT;

  try {
    const value = Number(window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY));
    return Number.isFinite(value)
      ? clampBottomPanelHeight(value)
      : clampBottomPanelHeight(DEFAULT_BOTTOM_PANEL_HEIGHT);
  } catch {
    return DEFAULT_BOTTOM_PANEL_HEIGHT;
  }
}

function writeStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in hardened test/browser environments.
  }
}

function removeStoredValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Local storage can be unavailable in hardened test/browser environments.
  }
}

function isBottomPanel(value: unknown): value is DesktopBottomPanel {
  return value === 'board-chat' || value === 'squad-chat';
}

export function DesktopShellProvider({ children }: { children: ReactNode }) {
  const desktopClient = isDesktopClient();
  const supportsWorkbenchPanel = useMediaQuery('(min-width: 768px)', false);
  const canUseBottomPanel = desktopClient || supportsWorkbenchPanel;
  const [leftRailOpen, setLeftRailOpenState] = useState(() =>
    readStoredBoolean(LEFT_RAIL_STORAGE_KEY, true)
  );
  const [rightRailOpen, setRightRailOpenState] = useState(() =>
    readStoredBoolean(RIGHT_RAIL_STORAGE_KEY, false)
  );
  const [bottomPanel, setBottomPanel] = useState<DesktopBottomPanel | null>(null);
  const [bottomPanelHeight, setBottomPanelHeightState] = useState(() =>
    readStoredBottomPanelHeight()
  );

  const setLeftRailOpen = useCallback(
    (open: boolean) => {
      setLeftRailOpenState(open);
      if (desktopClient) writeStoredValue(LEFT_RAIL_STORAGE_KEY, String(open));
    },
    [desktopClient]
  );

  const setRightRailOpen = useCallback(
    (open: boolean) => {
      setRightRailOpenState(open);
      if (desktopClient) writeStoredValue(RIGHT_RAIL_STORAGE_KEY, String(open));
    },
    [desktopClient]
  );

  const setBottomPanelHeight = useCallback((height: number) => {
    const next = clampBottomPanelHeight(height);
    setBottomPanelHeightState(next);
    writeStoredValue(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, String(next));
  }, []);

  const closeBottomPanel = useCallback(() => {
    setBottomPanel(null);
    removeStoredValue(BOTTOM_PANEL_STORAGE_KEY);
    if (typeof window !== 'undefined' && window.history.state?.[BOTTOM_PANEL_HISTORY_STATE_KEY]) {
      window.history.back();
    }
  }, []);

  const openBottomPanel = useCallback((panel: DesktopBottomPanel) => {
    setBottomPanel(panel);
    removeStoredValue(BOTTOM_PANEL_STORAGE_KEY);
    if (typeof window === 'undefined') return;

    const state = {
      ...(typeof window.history.state === 'object' && window.history.state
        ? window.history.state
        : {}),
      [BOTTOM_PANEL_HISTORY_STATE_KEY]: panel,
    };
    if (window.history.state?.[BOTTOM_PANEL_HISTORY_STATE_KEY]) {
      window.history.replaceState(state, '', window.location.href);
    } else {
      window.history.pushState(state, '', window.location.href);
    }
  }, []);

  const toggleBottomPanel = useCallback(
    (panel: DesktopBottomPanel = 'board-chat') => {
      if (bottomPanel === panel) {
        closeBottomPanel();
        return;
      }
      openBottomPanel(panel);
    },
    [bottomPanel, closeBottomPanel, openBottomPanel]
  );

  const resetDesktopLayout = useCallback(() => {
    setLeftRailOpenState(true);
    setRightRailOpenState(false);
    setBottomPanel(null);
    setBottomPanelHeightState(clampBottomPanelHeight(DEFAULT_BOTTOM_PANEL_HEIGHT));
    removeStoredValue(LEFT_RAIL_STORAGE_KEY);
    removeStoredValue(RIGHT_RAIL_STORAGE_KEY);
    removeStoredValue(BOTTOM_PANEL_STORAGE_KEY);
    removeStoredValue(BOTTOM_PANEL_HEIGHT_STORAGE_KEY);
    if (
      typeof window !== 'undefined' &&
      typeof window.history.state === 'object' &&
      window.history.state
    ) {
      const { [BOTTOM_PANEL_HISTORY_STATE_KEY]: _panel, ...rest } = window.history.state;
      window.history.replaceState(rest, '', window.location.href);
    }
  }, []);

  useEffect(() => {
    if (!desktopClient || typeof document === 'undefined') return;
    document.documentElement.dataset.client = 'desktop';
  }, [desktopClient]);

  useEffect(() => {
    removeStoredValue(BOTTOM_PANEL_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !bottomPanel) return;
      event.preventDefault();
      closeBottomPanel();
    };
    const handlePopState = (event: PopStateEvent) => {
      const panel = event.state?.[BOTTOM_PANEL_HISTORY_STATE_KEY];
      setBottomPanel(isBottomPanel(panel) ? panel : null);
    };
    const handleResize = () => {
      setBottomPanelHeightState((current) => {
        const next = clampBottomPanelHeight(current);
        if (next !== current) {
          writeStoredValue(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, String(next));
        }
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('resize', handleResize);
    };
  }, [bottomPanel, closeBottomPanel]);

  useEffect(() => {
    const desktop = (
      window as Window & {
        veritasDesktop?: {
          onMenuCommand?: (listener: (payload: { command: string }) => void) => () => void;
        };
      }
    ).veritasDesktop;
    return desktop?.onMenuCommand?.((payload) => {
      if (payload.command === 'reset-layout') resetDesktopLayout();
    });
  }, [resetDesktopLayout]);

  const value = useMemo<DesktopShellContextValue>(
    () => ({
      isDesktopClient: desktopClient,
      leftRailOpen: desktopClient ? leftRailOpen : false,
      rightRailOpen: desktopClient ? rightRailOpen : false,
      bottomPanel: canUseBottomPanel ? bottomPanel : null,
      bottomPanelHeight,
      setLeftRailOpen,
      setRightRailOpen,
      setBottomPanelHeight,
      openBottomPanel,
      closeBottomPanel,
      toggleBottomPanel,
    }),
    [
      bottomPanel,
      closeBottomPanel,
      canUseBottomPanel,
      desktopClient,
      bottomPanelHeight,
      leftRailOpen,
      openBottomPanel,
      rightRailOpen,
      setBottomPanelHeight,
      setLeftRailOpen,
      setRightRailOpen,
      toggleBottomPanel,
    ]
  );

  return <DesktopShellContext.Provider value={value}>{children}</DesktopShellContext.Provider>;
}

export function useDesktopShell() {
  return useContext(DesktopShellContext);
}
