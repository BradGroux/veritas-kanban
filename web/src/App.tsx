import { KanbanBoard } from './components/board/KanbanBoard';
import { Header } from './components/layout/Header';
import { Toaster } from './components/ui/toaster';
import { KeyboardProvider } from './hooks/useKeyboard';
import { KeyboardShortcutsDialog } from './components/layout/KeyboardShortcutsDialog';

function App() {
  return (
    <KeyboardProvider>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-6">
          <KanbanBoard />
        </main>
        <Toaster />
        <KeyboardShortcutsDialog />
      </div>
    </KeyboardProvider>
  );
}

export default App;
