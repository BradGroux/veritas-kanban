import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useMediaQuery } from '@mantine/hooks';

export type DesktopBottomPanel = 'board-chat' | 'squad-chat';
export type DesktopDockPosition = 'right' | 'bottom';

interface DesktopShellContextValue {
  isDesktopClient: boolean;
  leftRailOpen: boolean;
  rightRailOpen: boolean;
  bottomPanel: DesktopBottomPanel | null;
  dockPosition: DesktopDockPosition;
  bottomPanelHeight: number;
  rightPanelWidth: number;
  setLeftRailOpen: (open: boolean) => void;
  setRightRailOpen: (open: boolean) => void;
  setDockPosition: (position: DesktopDockPosition) => void;
  setBottomPanelHeight: (height: number) => void;
  setRightPanelWidth: (width: number) => void;
  openBottomPanel: (panel: DesktopBottomPanel) => void;
  closeBottomPanel: () => void;
  toggleBottomPanel: (panel?: DesktopBottomPanel) => void;
}

const LEFT_RAIL_STORAGE_KEY = 'veritas.desktop.leftRailOpen';
const RIGHT_RAIL_STORAGE_KEY = 'veritas.desktop.rightRailOpen';
const BOTTOM_PANEL_STORAGE_KEY = 'veritas.desktop.bottomPanel';
const BOTTOM_PANEL_HEIGHT_STORAGE_KEY = 'veritas.workbench.bottomPanelHeight';
const DOCK_POSITION_STORAGE_KEY = 'veritas.workbench.dockPosition';
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'veritas.workbench.rightPanelWidth';
const BOTTOM_PANEL_HISTORY_STATE_KEY = 'veritasBottomPanel';
const BOTTOM_PANEL_VIEWPORT_RESERVE = 320;
const RIGHT_PANEL_VIEWPORT_RESERVE = 520;
const COMPACT_BOTTOM_PANEL_HEIGHT = 200;
const COMPACT_RIGHT_PANEL_WIDTH = 280;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 340;
export const MIN_BOTTOM_PANEL_HEIGHT = 320;
export const MAX_BOTTOM_PANEL_HEIGHT = 640;
export const DEFAULT_RIGHT_PANEL_WIDTH = 420;
export const MIN_RIGHT_PANEL_WIDTH = 320;
export const MAX_RIGHT_PANEL_WIDTH = 640;

const DEFAULT_CONTEXT: DesktopShellContextValue = {
  isDesktopClient: false,
  leftRailOpen: false,
  rightRailOpen: false,
  bottomPanel: null,
  dockPosition: 'right',
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
  rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
  setLeftRailOpen: () => undefined,
  setRightRailOpen: () => undefined,
  setDockPosition: () => undefined,
  setBottomPanelHeight: () => undefined,
  setRightPanelWidth: () => undefined,
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
  const finiteHeight = Number.isFinite(height) ? height : DEFAULT_BOTTOM_PANEL_HEIGHT;
  const viewportMax =
    typeof window === 'undefined'
      ? MAX_BOTTOM_PANEL_HEIGHT
      : Math.min(
          MAX_BOTTOM_PANEL_HEIGHT,
          Math.max(COMPACT_BOTTOM_PANEL_HEIGHT, window.innerHeight - BOTTOM_PANEL_VIEWPORT_RESERVE)
        );
  const viewportMin = Math.min(MIN_BOTTOM_PANEL_HEIGHT, viewportMax);
  return Math.min(viewportMax, Math.max(viewportMin, finiteHeight));
}

function clampRightPanelWidth(width: number): number {
  const finiteWidth = Number.isFinite(width) ? width : DEFAULT_RIGHT_PANEL_WIDTH;
  const viewportMax =
    typeof window === 'undefined'
      ? MAX_RIGHT_PANEL_WIDTH
      : Math.min(
          MAX_RIGHT_PANEL_WIDTH,
          Math.max(COMPACT_RIGHT_PANEL_WIDTH, window.innerWidth - RIGHT_PANEL_VIEWPORT_RESERVE)
        );
  const viewportMin = Math.min(MIN_RIGHT_PANEL_WIDTH, viewportMax);
  return Math.min(viewportMax, Math.max(viewportMin, finiteWidth));
}

function readStoredBottomPanelHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_BOTTOM_PANEL_HEIGHT;

  try {
    const stored = window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY);
    if (stored === null) return clampBottomPanelHeight(DEFAULT_BOTTOM_PANEL_HEIGHT);
    const value = Number(stored);
    return Number.isFinite(value) && value > 0
      ? clampBottomPanelHeight(value)
      : clampBottomPanelHeight(DEFAULT_BOTTOM_PANEL_HEIGHT);
  } catch {
    return DEFAULT_BOTTOM_PANEL_HEIGHT;
  }
}

function readStoredRightPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_RIGHT_PANEL_WIDTH;

  try {
    const stored = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    if (stored === null) return clampRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH);
    const value = Number(stored);
    return Number.isFinite(value) && value > 0
      ? clampRightPanelWidth(value)
      : clampRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH);
  } catch {
    return DEFAULT_RIGHT_PANEL_WIDTH;
  }
}

function readStoredDockPosition(): DesktopDockPosition {
  if (typeof window === 'undefined') return 'right';

  try {
    const stored = window.localStorage.getItem(DOCK_POSITION_STORAGE_KEY);
    if (stored === 'right' || stored === 'bottom') return stored;
    if (stored !== null) window.localStorage.removeItem(DOCK_POSITION_STORAGE_KEY);
  } catch {
    // Use the safe desktop default when storage is unavailable.
  }
  return 'right';
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
  const panelTriggerRef = useRef<HTMLElement | null>(null);
  const [leftRailOpen, setLeftRailOpenState] = useState(() =>
    readStoredBoolean(LEFT_RAIL_STORAGE_KEY, true)
  );
  const [rightRailOpen, setRightRailOpenState] = useState(() =>
    readStoredBoolean(RIGHT_RAIL_STORAGE_KEY, false)
  );
  const [bottomPanel, setBottomPanel] = useState<DesktopBottomPanel | null>(null);
  const [dockPosition, setDockPositionState] = useState<DesktopDockPosition>(() =>
    readStoredDockPosition()
  );
  const [bottomPanelHeight, setBottomPanelHeightState] = useState(() =>
    readStoredBottomPanelHeight()
  );
  const [rightPanelWidth, setRightPanelWidthState] = useState(() => readStoredRightPanelWidth());

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

  const setDockPosition = useCallback(
    (position: DesktopDockPosition) => {
      setDockPositionState(position);
      if (desktopClient) writeStoredValue(DOCK_POSITION_STORAGE_KEY, position);
    },
    [desktopClient]
  );

  const setBottomPanelHeight = useCallback((height: number) => {
    const next = clampBottomPanelHeight(height);
    setBottomPanelHeightState(next);
    writeStoredValue(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, String(next));
  }, []);

  const setRightPanelWidth = useCallback((width: number) => {
    const next = clampRightPanelWidth(width);
    setRightPanelWidthState(next);
    writeStoredValue(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(next));
  }, []);

  const restorePanelFocus = useCallback(() => {
    const trigger = panelTriggerRef.current;
    panelTriggerRef.current = null;
    if (!trigger) return;
    requestAnimationFrame(() => {
      if (trigger.isConnected) trigger.focus();
    });
  }, []);

  const closeBottomPanel = useCallback(() => {
    setBottomPanel(null);
    removeStoredValue(BOTTOM_PANEL_STORAGE_KEY);
    restorePanelFocus();
    if (typeof window !== 'undefined' && window.history.state?.[BOTTOM_PANEL_HISTORY_STATE_KEY]) {
      window.history.back();
    }
  }, [restorePanelFocus]);

  const openBottomPanel = useCallback(
    (panel: DesktopBottomPanel) => {
      if (!bottomPanel && document.activeElement instanceof HTMLElement) {
        panelTriggerRef.current = document.activeElement;
      }
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
    },
    [bottomPanel]
  );

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
    setDockPositionState('right');
    setBottomPanelHeightState(clampBottomPanelHeight(DEFAULT_BOTTOM_PANEL_HEIGHT));
    setRightPanelWidthState(clampRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH));
    removeStoredValue(LEFT_RAIL_STORAGE_KEY);
    removeStoredValue(RIGHT_RAIL_STORAGE_KEY);
    removeStoredValue(BOTTOM_PANEL_STORAGE_KEY);
    removeStoredValue(BOTTOM_PANEL_HEIGHT_STORAGE_KEY);
    removeStoredValue(DOCK_POSITION_STORAGE_KEY);
    removeStoredValue(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    restorePanelFocus();
    if (
      typeof window !== 'undefined' &&
      typeof window.history.state === 'object' &&
      window.history.state
    ) {
      const { [BOTTOM_PANEL_HISTORY_STATE_KEY]: _panel, ...rest } = window.history.state;
      window.history.replaceState(rest, '', window.location.href);
    }
  }, [restorePanelFocus]);

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
      if (!isBottomPanel(panel)) restorePanelFocus();
    };
    const handleResize = () => {
      setBottomPanelHeightState((current) => {
        const next = clampBottomPanelHeight(current);
        if (next !== current) {
          writeStoredValue(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, String(next));
        }
        return next;
      });
      setRightPanelWidthState((current) => {
        const next = clampRightPanelWidth(current);
        if (next !== current) {
          writeStoredValue(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(next));
        }
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleResize);
    };
  }, [bottomPanel, closeBottomPanel, restorePanelFocus]);

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
      dockPosition: desktopClient ? dockPosition : 'bottom',
      bottomPanelHeight,
      rightPanelWidth,
      setLeftRailOpen,
      setRightRailOpen,
      setDockPosition,
      setBottomPanelHeight,
      setRightPanelWidth,
      openBottomPanel,
      closeBottomPanel,
      toggleBottomPanel,
    }),
    [
      bottomPanel,
      closeBottomPanel,
      canUseBottomPanel,
      desktopClient,
      dockPosition,
      bottomPanelHeight,
      leftRailOpen,
      openBottomPanel,
      rightPanelWidth,
      rightRailOpen,
      setDockPosition,
      setBottomPanelHeight,
      setLeftRailOpen,
      setRightPanelWidth,
      setRightRailOpen,
      toggleBottomPanel,
    ]
  );

  return <DesktopShellContext.Provider value={value}>{children}</DesktopShellContext.Provider>;
}

export function useDesktopShell() {
  return useContext(DesktopShellContext);
}
