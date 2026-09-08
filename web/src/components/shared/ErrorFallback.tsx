import { AlertCircle, ChevronDown, ChevronUp, RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export type ErrorLevel = 'page' | 'section' | 'widget';

interface ErrorFallbackProps {
  error: Error;
  level: ErrorLevel;
  onRetry: () => void;
}

// ────────────────────────────────────────────────────────────
// Page-level: full-screen centered error
// ────────────────────────────────────────────────────────────

function PageFallback({ error, onRetry: _onRetry }: Omit<ErrorFallbackProps, 'level'>) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-6">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
          <AlertCircle className="h-8 w-8 text-red-400" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            An unexpected error prevented the application from loading.
          </p>
        </div>

        {error && (
          <div className="text-left">
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
            >
              {showDetails ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {showDetails ? 'Hide' : 'Show'} error details
            </button>

            {showDetails && (
              <div className="mt-3 p-4 rounded-lg bg-muted/50 border border-border text-left">
                <code className="text-xs text-red-400 break-all whitespace-pre-wrap">
                  {error.message}
                </code>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-md bg-primary-action text-primary-foreground hover:bg-primary-action-hover transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Reload
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Section-level: card-style error within the layout
// ────────────────────────────────────────────────────────────

function SectionFallback({ error, onRetry }: Omit<ErrorFallbackProps, 'level'>) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-[200px] p-6">
      <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              This section encountered an error
            </h3>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. You can try again or reload the page if the issue
              persists.
            </p>

            {error && (
              <div className="pt-2">
                <button
                  onClick={() => setShowDetails((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showDetails ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {showDetails ? 'Hide' : 'Show'} error details
                </button>

                {showDetails && (
                  <div className="mt-2 p-3 rounded bg-muted/50 border border-border">
                    <code className="text-xs text-red-400 break-all whitespace-pre-wrap">
                      {error.message}
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onRetry}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors',
              'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Widget-level: inline subtle error text
// ────────────────────────────────────────────────────────────

function WidgetFallback({ onRetry }: Omit<ErrorFallbackProps, 'level'>) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <AlertCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
      <span>Failed to render</span>
      <button onClick={onRetry} className="text-xs text-primary hover:underline underline-offset-2">
        Retry
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Exported dispatcher component
// ────────────────────────────────────────────────────────────

export function ErrorFallback({ error, level, onRetry }: ErrorFallbackProps) {
  switch (level) {
    case 'page':
      return <PageFallback error={error} onRetry={onRetry} />;
    case 'section':
      return <SectionFallback error={error} onRetry={onRetry} />;
    case 'widget':
      return <WidgetFallback error={error} onRetry={onRetry} />;
    default:
      return <SectionFallback error={error} onRetry={onRetry} />;
  }
}
