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

function readStoredBottomPanel(): DesktopBottomPanel | null {
  if (typeof window === 'undefined') return null;

  try {
    const value = window.localStorage.getItem(BOTTOM_PANEL_STORAGE_KEY);
    return value === 'board-chat' || value === 'squad-chat' ? value : null;
  } catch {
    return null;
  }
}

function clampBottomPanelHeight(height: number): number {
  const viewportMax =
    typeof window === 'undefined'
      ? MAX_BOTTOM_PANEL_HEIGHT
      : Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.floor(window.innerHeight * 0.68));
  return Math.min(
    Math.min(MAX_BOTTOM_PANEL_HEIGHT, viewportMax),
    Math.max(MIN_BOTTOM_PANEL_HEIGHT, height)
  );
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
  const [bottomPanel, setBottomPanel] = useState<DesktopBottomPanel | null>(() =>
    readStoredBottomPanel()
  );
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

  const openBottomPanel = useCallback((panel: DesktopBottomPanel) => {
    setBottomPanel(panel);
    writeStoredValue(BOTTOM_PANEL_STORAGE_KEY, panel);
  }, []);

  const closeBottomPanel = useCallback(() => {
    setBottomPanel(null);
    writeStoredValue(BOTTOM_PANEL_STORAGE_KEY, 'closed');
  }, []);

  const toggleBottomPanel = useCallback((panel: DesktopBottomPanel = 'board-chat') => {
    setBottomPanel((current) => {
      const next = current === panel ? null : panel;
      writeStoredValue(BOTTOM_PANEL_STORAGE_KEY, next ?? 'closed');
      return next;
    });
  }, []);

  useEffect(() => {
    if (!desktopClient || typeof document === 'undefined') return;
    document.documentElement.dataset.client = 'desktop';
  }, [desktopClient]);

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
