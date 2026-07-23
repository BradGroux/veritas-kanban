import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Scale } from 'lucide-react';
import { Button } from '@mantine/core';

const SetupScreen = lazy(() =>
  import('./SetupScreen').then((mod) => ({
    default: mod.SetupScreen,
  }))
);

const LoginScreen = lazy(() =>
  import('./LoginScreen').then((mod) => ({
    default: mod.LoginScreen,
  }))
);

interface AuthGuardProps {
  children: ReactNode;
}

function AuthSurfaceFallback() {
  return (
    <div className="desktop-window-drag min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { status, isLoading, error, refreshStatus } = useAuth();
  const [isRestarting, setIsRestarting] = useState(false);
  const desktopBridge =
    typeof window !== 'undefined'
      ? (
          window as Window & {
            veritasDesktop?: { restartLocalServer?: () => Promise<unknown> };
          }
        ).veritasDesktop
      : undefined;

  const retryConnection = () => {
    void refreshStatus();
  };

  const restartLocalServer = async () => {
    if (!desktopBridge?.restartLocalServer) return;

    setIsRestarting(true);
    try {
      await desktopBridge.restartLocalServer();
      await refreshStatus();
    } catch (restartError) {
      console.error('[Auth] Failed to restart local server:', restartError);
    } finally {
      setIsRestarting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return <AuthSurfaceFallback />;
  }

  // Error state
  if (error && !status) {
    return (
      <div className="desktop-window-drag flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-7 text-center shadow-lg">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive">
            <Scale className="h-7 w-7" aria-hidden="true" />
          </div>
          <div className="mt-5 flex items-center justify-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <h1 className="text-lg font-semibold">Connection Error</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button
              variant="filled"
              size="sm"
              leftSection={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              onClick={retryConnection}
            >
              Retry
            </Button>
            {desktopBridge?.restartLocalServer && (
              <Button
                variant="light"
                color="gray"
                size="sm"
                loading={isRestarting}
                leftSection={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => void restartLocalServer()}
              >
                Restart local server
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Auth not enabled (no password set up yet, and auth not required)
  // This allows the app to work without auth until setup is completed
  if (status && !status.authEnabled && !status.needsSetup) {
    return <>{children}</>;
  }

  // Needs setup - show setup screen
  if (status?.needsSetup) {
    return (
      <Suspense fallback={<AuthSurfaceFallback />}>
        <SetupScreen />
      </Suspense>
    );
  }

  // Not authenticated - show login screen
  if (status && !status.authenticated) {
    return (
      <Suspense fallback={<AuthSurfaceFallback />}>
        <LoginScreen />
      </Suspense>
    );
  }

  // Authenticated - render the app
  return <>{children}</>;
}
