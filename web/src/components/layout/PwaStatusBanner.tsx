import { useEffect, useMemo, useState } from 'react';
import { Button } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, RefreshCw, WifiOff } from 'lucide-react';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaStatusBannerProps {
  sessionExpiry?: string | null;
  onRefreshAuth?: () => Promise<void> | void;
}

function readStandaloneStatus() {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isExpired(expiresAt?: string | null) {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export function PwaStatusBanner({ sessionExpiry, onRefreshAuth }: PwaStatusBannerProps) {
  const queryClient = useQueryClient();
  const { connectionState, reconnectAttempt, reconnect } = useWebSocketStatus();
  const { isOnline } = useNetworkStatus();
  const [standalone, setStandalone] = useState(readStandaloneStatus);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    const syncStandalone = () => setStandalone(readStandaloneStatus());
    mediaQuery?.addEventListener?.('change', syncStandalone);
    return () => mediaQuery?.removeEventListener?.('change', syncStandalone);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const sessionExpired = isExpired(sessionExpiry);
  const state = useMemo(() => {
    if (!isOnline) {
      return {
        label: 'Offline',
        description: 'Cached shell only. Task data and changes require the trusted server.',
        icon: WifiOff,
        tone: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
      };
    }

    if (sessionExpired) {
      return {
        label: 'Session expired',
        description: 'Refresh your session before making changes. Failed writes are not queued.',
        icon: AlertTriangle,
        tone: 'border-red-500/40 bg-red-500/10 text-red-100',
      };
    }

    if (connectionState === 'connecting' || connectionState === 'reconnecting') {
      return {
        label: reconnectAttempt > 0 ? `Reconnecting ${reconnectAttempt}` : 'Reconnecting',
        description:
          'Data may be stale while realtime sync restores. Writes still need the server.',
        icon: RefreshCw,
        tone: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
      };
    }

    if (connectionState === 'disconnected') {
      return {
        label: 'Realtime disconnected',
        description: 'Reads can retry over HTTP, but realtime updates are paused.',
        icon: WifiOff,
        tone: 'border-red-500/40 bg-red-500/10 text-red-100',
      };
    }

    return null;
  }, [connectionState, isOnline, reconnectAttempt, sessionExpired]);

  const installAvailable = !!installPrompt && !standalone;

  if (!state && !installAvailable) {
    return null;
  }

  const Icon = state?.icon ?? Download;

  const retry = async () => {
    setIsRetrying(true);
    try {
      reconnect?.();
      await onRefreshAuth?.();
      await queryClient.invalidateQueries();
    } finally {
      setIsRetrying(false);
    }
  };

  const install = async () => {
    if (!installPrompt) return;
    setIsInstalling(true);
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      setInstallPrompt(null);
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={state?.label ?? 'Install available'}
      className={`md:hidden border-b px-3 py-2 ${state?.tone ?? 'border-border bg-card text-card-foreground'}`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight">
            {state?.label ?? 'Install available'}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug opacity-85">
            {state?.description ??
              'Add Veritas to this device for a standalone trusted-host window.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {state && (
            <Button size="compact-xs" variant="light" onClick={retry} loading={isRetrying}>
              Retry
            </Button>
          )}
          {installAvailable && (
            <Button size="compact-xs" variant="filled" onClick={install} loading={isInstalling}>
              Install
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
