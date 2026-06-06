import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type DesktopBottomPanel = 'board-chat' | 'squad-chat';

interface DesktopShellContextValue {
  isDesktopClient: boolean;
  leftRailOpen: boolean;
  rightRailOpen: boolean;
  bottomPanel: DesktopBottomPanel | null;
  setLeftRailOpen: (open: boolean) => void;
  setRightRailOpen: (open: boolean) => void;
  openBottomPanel: (panel: DesktopBottomPanel) => void;
  closeBottomPanel: () => void;
  toggleBottomPanel: (panel?: DesktopBottomPanel) => void;
}

const LEFT_RAIL_STORAGE_KEY = 'veritas.desktop.leftRailOpen';
const RIGHT_RAIL_STORAGE_KEY = 'veritas.desktop.rightRailOpen';
const BOTTOM_PANEL_STORAGE_KEY = 'veritas.desktop.bottomPanel';

const DEFAULT_CONTEXT: DesktopShellContextValue = {
  isDesktopClient: false,
  leftRailOpen: false,
  rightRailOpen: false,
  bottomPanel: null,
  setLeftRailOpen: () => undefined,
  setRightRailOpen: () => undefined,
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

function writeStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in hardened test/browser environments.
  }
}

export function DesktopShellProvider({ children }: { children: ReactNode }) {
  const desktopClient = isDesktopClient();
  const [leftRailOpen, setLeftRailOpenState] = useState(() =>
    readStoredBoolean(LEFT_RAIL_STORAGE_KEY, true)
  );
  const [rightRailOpen, setRightRailOpenState] = useState(() =>
    readStoredBoolean(RIGHT_RAIL_STORAGE_KEY, false)
  );
  const [bottomPanel, setBottomPanel] = useState<DesktopBottomPanel | null>(() =>
    readStoredBottomPanel()
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

  const openBottomPanel = useCallback(
    (panel: DesktopBottomPanel) => {
      setBottomPanel(panel);
      if (desktopClient) writeStoredValue(BOTTOM_PANEL_STORAGE_KEY, panel);
    },
    [desktopClient]
  );

  const closeBottomPanel = useCallback(() => {
    setBottomPanel(null);
    if (desktopClient) writeStoredValue(BOTTOM_PANEL_STORAGE_KEY, 'closed');
  }, [desktopClient]);

  const toggleBottomPanel = useCallback(
    (panel: DesktopBottomPanel = 'board-chat') => {
      setBottomPanel((current) => {
        const next = current === panel ? null : panel;
        if (desktopClient) writeStoredValue(BOTTOM_PANEL_STORAGE_KEY, next ?? 'closed');
        return next;
      });
    },
    [desktopClient]
  );

  useEffect(() => {
    if (!desktopClient || typeof document === 'undefined') return;
    document.documentElement.dataset.client = 'desktop';
  }, [desktopClient]);

  const value = useMemo<DesktopShellContextValue>(
    () => ({
      isDesktopClient: desktopClient,
      leftRailOpen: desktopClient ? leftRailOpen : false,
      rightRailOpen: desktopClient ? rightRailOpen : false,
      bottomPanel: desktopClient ? bottomPanel : null,
      setLeftRailOpen,
      setRightRailOpen,
      openBottomPanel,
      closeBottomPanel,
      toggleBottomPanel,
    }),
    [
      bottomPanel,
      closeBottomPanel,
      desktopClient,
      leftRailOpen,
      openBottomPanel,
      rightRailOpen,
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
