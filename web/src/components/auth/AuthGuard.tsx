import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { status, isLoading, error } = useAuth();

  // Loading state
  if (isLoading) {
    return <AuthSurfaceFallback />;
  }

  // Error state
  if (error && !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-destructive text-6xl">⚠️</div>
          <h1 className="text-xl font-bold">Connection Error</h1>
          <p className="text-muted-foreground">{error}</p>
          <button onClick={() => window.location.reload()} className="text-primary hover:underline">
            Try again
          </button>
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
