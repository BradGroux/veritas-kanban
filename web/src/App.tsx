import { lazy, Suspense, useEffect, useState } from 'react';
import { Box } from '@mantine/core';
import { KanbanBoard } from './components/board/KanbanBoard';
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
import { AuthGuard } from './components/auth';
import { DesktopOnboardingDialog } from './components/auth/DesktopOnboarding';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { SkipToContent } from './components/shared/SkipToContent';
import { LiveAnnouncerProvider } from './components/shared/LiveAnnouncer';
import { FloatingChat } from './components/chat/FloatingChat';
import { SystemHealthBar } from './components/layout/SystemHealthBar';
import { MobileShell } from './components/layout/MobileShell';
import { PwaStatusBanner } from './components/layout/PwaStatusBanner';
import { NAVIGATION_VIEWS, VIEW_BY_ID, type AppView, type NavigationView } from './lib/views';
import { usePendingProductMode } from './hooks/usePendingProductMode';

const LAZY_VIEW_COMPONENTS = Object.fromEntries(
  NAVIGATION_VIEWS.map((definition) => {
    if (!definition.loadComponent) {
      throw new Error(`Navigation view ${definition.view} is missing a lazy component loader.`);
    }
    return [definition.view, lazy(definition.loadComponent)];
  })
) as Record<NavigationView, ReturnType<typeof lazy>>;

function ViewLoading({ view }: { view: AppView }) {
  return (
    <div className="flex items-center justify-center py-16">
      <span className="text-muted-foreground">{VIEW_BY_ID[view].loadingLabel ?? 'Loading...'}</span>
    </div>
  );
}

/** Renders the current view (board, activity feed, or backlog). */
function MainContent() {
  const { view, setView, navigateToTask } = useView();

  if (view === 'board') return <KanbanBoard />;

  const ViewComponent = LAZY_VIEW_COMPONENTS[view];
  return (
    <Suspense fallback={<ViewLoading view={view} />}>
      <ViewComponent onBack={() => setView('board')} onTaskClick={navigateToTask} />
    </Suspense>
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
                  <Box className="min-h-screen bg-background">
                    <SkipToContent />
                    <Header />
                    <SystemHealthBar />
                    <PwaStatusBanner
                      sessionExpiry={authStatus?.sessionExpiry}
                      onRefreshAuth={refreshStatus}
                    />
                    <Box
                      component="main"
                      id="main-content"
                      px={{ base: 'md', md: '3.5rem' }}
                      pt="lg"
                      pb={{ base: '6rem', md: 'lg' }}
                      tabIndex={-1}
                    >
                      <ErrorBoundary level="section">
                        <MainContent />
                      </ErrorBoundary>
                    </Box>
                    <Toaster />
                    <CommandPalette />
                    <FloatingChat />
                    <MobileShell />
                    <DesktopOnboardingDialog
                      open={showDesktopOnboarding}
                      onOpenChange={setShowDesktopOnboarding}
                    />
                  </Box>
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
