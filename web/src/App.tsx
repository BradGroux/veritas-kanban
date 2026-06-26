import { lazy, Suspense, useEffect, useState } from 'react';
import { Box } from '@mantine/core';
import { Header } from './components/layout/Header';
import { Toaster } from './components/ui/toaster';
import { KeyboardProvider } from './hooks/useKeyboard';
import { CommandPalette } from './components/layout/CommandPalette';
import { BulkActionsProvider } from './hooks/useBulkActions';
import { useTaskSync } from './hooks/useTaskSync';
import { TaskConfigProvider } from './contexts/TaskConfigContext';
import { WebSocketStatusProvider } from './contexts/WebSocketContext';
import { ViewProvider, useView } from './contexts/ViewContext';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { IdentityProvider } from './hooks/useIdentity';
import { AuthGuard } from './components/auth/AuthGuard';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { SkipToContent } from './components/shared/SkipToContent';
import { LiveAnnouncerProvider } from './components/shared/LiveAnnouncer';
import { NAVIGATION_VIEWS, VIEW_BY_ID, type AppView, type NavigationView } from './lib/views';
import { usePendingProductMode } from './hooks/usePendingProductMode';
import { DesktopShellProvider, useDesktopShell } from './components/layout/DesktopShellContext';
import { DesktopLeftSidebar } from './components/layout/DesktopLeftSidebar';
import { DesktopBottomPanel } from './components/layout/DesktopBottomPanel';
import { RunSessionShareView } from './components/task/RunSessionSharesSection';

const LAZY_VIEW_COMPONENTS = Object.fromEntries(
  NAVIGATION_VIEWS.map((definition) => {
    if (!definition.loadComponent) {
      throw new Error(`Navigation view ${definition.view} is missing a lazy component loader.`);
    }
    return [definition.view, lazy(definition.loadComponent)];
  })
) as Record<NavigationView, ReturnType<typeof lazy>>;

const KanbanBoard = lazy(() =>
  import('./components/board/KanbanBoard').then((mod) => ({
    default: mod.KanbanBoard,
  }))
);

const FloatingChat = lazy(() =>
  import('./components/chat/FloatingChat').then((mod) => ({
    default: mod.FloatingChat,
  }))
);

const DesktopOnboardingDialog = lazy(() =>
  import('./components/auth/DesktopOnboarding').then((mod) => ({
    default: mod.DesktopOnboardingDialog,
  }))
);

const MobileShell = lazy(() =>
  import('./components/layout/MobileShell').then((mod) => ({
    default: mod.MobileShell,
  }))
);

const PwaStatusBanner = lazy(() =>
  import('./components/layout/PwaStatusBanner').then((mod) => ({
    default: mod.PwaStatusBanner,
  }))
);

const SystemHealthBar = lazy(() =>
  import('./components/layout/SystemHealthBar').then((mod) => ({
    default: mod.SystemHealthBar,
  }))
);

function ViewLoading({ view }: { view: AppView }) {
  return (
    <div className="flex items-center justify-center py-16">
      <span className="text-muted-foreground">{VIEW_BY_ID[view].loadingLabel ?? 'Loading...'}</span>
    </div>
  );
}

function runSessionShareIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname.replace(/\/+$/, '');
  const match = path.match(/\/runs\/shared\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Renders the current view (board, activity feed, or backlog). */
function MainContent() {
  const { view, setView, navigateToTask } = useView();
  const runSessionShareId = runSessionShareIdFromLocation();

  if (runSessionShareId) return <RunSessionShareView shareId={runSessionShareId} />;

  if (view === 'board') {
    return (
      <Suspense fallback={<ViewLoading view="board" />}>
        <KanbanBoard />
      </Suspense>
    );
  }

  const ViewComponent = LAZY_VIEW_COMPONENTS[view];
  return (
    <Suspense fallback={<ViewLoading view={view} />}>
      <ViewComponent onBack={() => setView('board')} onTaskClick={navigateToTask} />
    </Suspense>
  );
}

function DesktopAwareAppShell({
  authStatus,
  refreshStatus,
  showDesktopOnboarding,
  setShowDesktopOnboarding,
}: {
  authStatus: ReturnType<typeof useAuth>['status'];
  refreshStatus: ReturnType<typeof useAuth>['refreshStatus'];
  showDesktopOnboarding: boolean;
  setShowDesktopOnboarding: (open: boolean) => void;
}) {
  const { isDesktopClient, bottomPanel } = useDesktopShell();

  return (
    <Box className="desktop-app-shell min-h-screen bg-background">
      <SkipToContent />
      <Header />
      <Suspense fallback={<div className="h-7 border-b border-border bg-muted/30" aria-hidden />}>
        <SystemHealthBar />
      </Suspense>
      <Suspense fallback={null}>
        <PwaStatusBanner sessionExpiry={authStatus?.sessionExpiry} onRefreshAuth={refreshStatus} />
      </Suspense>
      <div className="desktop-workbench">
        <DesktopLeftSidebar />
        <Box
          component="main"
          id="main-content"
          px={isDesktopClient ? 'md' : { base: 'md', md: '3.5rem' }}
          pt={isDesktopClient ? 'md' : 'lg'}
          pb={bottomPanel ? 'md' : isDesktopClient ? 'lg' : { base: '6rem', md: 'lg' }}
          tabIndex={-1}
          className="desktop-main-content"
        >
          <ErrorBoundary level="section">
            <MainContent />
          </ErrorBoundary>
        </Box>
      </div>
      <DesktopBottomPanel />
      <Toaster />
      <CommandPalette />
      {!isDesktopClient && !bottomPanel && (
        <Suspense fallback={null}>
          <FloatingChat />
        </Suspense>
      )}
      <Suspense fallback={null}>{!isDesktopClient && <MobileShell />}</Suspense>
      {showDesktopOnboarding && (
        <Suspense fallback={null}>
          <DesktopOnboardingDialog
            open={showDesktopOnboarding}
            onOpenChange={setShowDesktopOnboarding}
          />
        </Suspense>
      )}
    </Box>
  );
}

// Main app content (only rendered when authenticated)
function AppContent() {
  // Connect to WebSocket for real-time task updates
  const { isConnected, connectionState, reconnectAttempt, reconnect } = useTaskSync();
  const { status: authStatus, refreshStatus } = useAuth();
  const [showDesktopOnboarding, setShowDesktopOnboarding] = useState(false);
  usePendingProductMode();

  useEffect(() => {
    const openDiagnostics = () => setShowDesktopOnboarding(true);
    const desktop = (
      window as Window & {
        veritasDesktop?: {
          onMenuCommand(listener: (payload: { command: string }) => void): () => void;
        };
      }
    ).veritasDesktop;

    const unsubscribe = desktop?.onMenuCommand?.((payload) => {
      if (
        payload.command === 'open-onboarding' ||
        payload.command === 'show-diagnostics' ||
        payload.command === 'communication-health'
      ) {
        setShowDesktopOnboarding(true);
      }
    });

    window.addEventListener('veritas:open-diagnostics', openDiagnostics);

    return () => {
      unsubscribe?.();
      window.removeEventListener('veritas:open-diagnostics', openDiagnostics);
    };
  }, []);

  return (
    <WebSocketStatusProvider
      isConnected={isConnected}
      connectionState={connectionState}
      reconnectAttempt={reconnectAttempt}
      reconnect={reconnect}
    >
      <LiveAnnouncerProvider>
        <KeyboardProvider>
          <BulkActionsProvider>
            <TaskConfigProvider>
              <ViewProvider>
                <IdentityProvider>
                  <DesktopShellProvider>
                    <DesktopAwareAppShell
                      authStatus={authStatus}
                      refreshStatus={refreshStatus}
                      showDesktopOnboarding={showDesktopOnboarding}
                      setShowDesktopOnboarding={setShowDesktopOnboarding}
                    />
                  </DesktopShellProvider>
                </IdentityProvider>
              </ViewProvider>
            </TaskConfigProvider>
          </BulkActionsProvider>
        </KeyboardProvider>
      </LiveAnnouncerProvider>
    </WebSocketStatusProvider>
  );
}

function App() {
  return (
    <ErrorBoundary level="page">
      <AuthProvider>
        <AuthGuard>
          <AppContent />
        </AuthGuard>
        <Toaster />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
