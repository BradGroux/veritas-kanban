import { lazy, Suspense } from 'react';
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
import { AuthProvider } from './hooks/useAuth';
import { AuthGuard } from './components/auth';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { SkipToContent } from './components/shared/SkipToContent';
import { LiveAnnouncerProvider } from './components/shared/LiveAnnouncer';
import { FloatingChat } from './components/chat/FloatingChat';

// Lazy-load ActivityFeed and BacklogPage to keep initial bundle small
const ActivityFeed = lazy(() =>
  import('./components/activity/ActivityFeed').then((mod) => ({
    default: mod.ActivityFeed,
  }))
);

const BacklogPage = lazy(() =>
  import('./components/backlog/BacklogPage').then((mod) => ({
    default: mod.BacklogPage,
  }))
);

const ArchivePage = lazy(() =>
  import('./components/archive/ArchivePage').then((mod) => ({
    default: mod.ArchivePage,
  }))
);

/** Renders the current view (board, activity feed, or backlog). */
function MainContent() {
  const { view, setView, navigateToTask } = useView();

  if (view === 'activity') {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <span className="text-muted-foreground">Loading activity feed…</span>
          </div>
        }
      >
        <ActivityFeed
          onBack={() => setView('board')}
          onTaskClick={(taskId) => navigateToTask(taskId)}
        />
      </Suspense>
    );
  }

  if (view === 'backlog') {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <span className="text-muted-foreground">Loading backlog…</span>
          </div>
        }
      >
        <BacklogPage onBack={() => setView('board')} />
      </Suspense>
    );
  }

  if (view === 'archive') {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <span className="text-muted-foreground">Loading archive…</span>
          </div>
        }
      >
        <ArchivePage onBack={() => setView('board')} />
      </Suspense>
    );
  }

  return <KanbanBoard />;
}

// Main app content (only rendered when authenticated)
function AppContent() {
  // Connect to WebSocket for real-time task updates
  const { isConnected, connectionState, reconnectAttempt } = useTaskSync();

  return (
    <WebSocketStatusProvider
      isConnected={isConnected}
      connectionState={connectionState}
      reconnectAttempt={reconnectAttempt}
    >
      <LiveAnnouncerProvider>
        <KeyboardProvider>
          <BulkActionsProvider>
            <TaskConfigProvider>
              <ViewProvider>
                <div className="min-h-screen bg-background">
                  <SkipToContent />
                  <Header />
                  <main id="main-content" className="mx-auto px-14 py-6" tabIndex={-1}>
                    <ErrorBoundary level="section">
                      <MainContent />
                    </ErrorBoundary>
                  </main>
                  <Toaster />
                  <CommandPalette />
                  <FloatingChat />
                </div>
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
