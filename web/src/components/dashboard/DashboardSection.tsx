import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, BarChart3 } from 'lucide-react';
import { Dashboard } from './Dashboard';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'veritas-kanban-dashboard-expanded';

export function DashboardSection() {
  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'true';
    }
    return false;
  });

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  // Keyboard shortcut (D to toggle)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }
      
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setExpanded(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="mt-6 border-t pt-4">
      {/* Collapsible Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg',
          'hover:bg-muted/50 transition-colors',
          'text-left'
        )}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Dashboard</span>
        <span className="text-xs text-muted-foreground ml-2">(D to toggle)</span>
      </button>

      {/* Dashboard Content */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          expanded ? 'max-h-[800px] opacity-100 mt-4' : 'max-h-0 opacity-0'
        )}
      >
        {expanded && <Dashboard />}
      </div>
    </div>
  );
}
