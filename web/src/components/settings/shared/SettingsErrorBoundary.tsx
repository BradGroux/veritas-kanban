import React, { Component, ReactNode } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SettingsErrorBoundaryProps {
  tabName: string;
  children: ReactNode;
}

interface SettingsErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorExpanded: boolean;
}

export class SettingsErrorBoundary extends Component<
  SettingsErrorBoundaryProps,
  SettingsErrorBoundaryState
> {
  constructor(props: SettingsErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorExpanded: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<SettingsErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`Settings tab "${this.props.tabName}" crashed:`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorExpanded: false,
    });
  };

  toggleErrorDetails = () => {
    this.setState((prev) => ({ errorExpanded: !prev.errorExpanded }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 space-y-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2">
                <h3 className="text-base font-semibold text-foreground">
                  This section failed to load
                </h3>
                <p className="text-sm text-muted-foreground">
                  The {this.props.tabName} tab encountered an unexpected error and couldn't render properly.
                </p>
                
                {this.state.error && (
                  <div className="pt-2">
                    <button
                      onClick={this.toggleErrorDetails}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {this.state.errorExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      {this.state.errorExpanded ? 'Hide' : 'Show'} error details
                    </button>
                    
                    {this.state.errorExpanded && (
                      <div className="mt-2 p-3 rounded bg-background/50 border border-border">
                        <code className="text-xs text-red-400 break-all whitespace-pre-wrap">
                          {this.state.error.message}
                          {this.state.error.stack && (
                            <div className="mt-2 text-muted-foreground text-[10px] leading-relaxed">
                              {this.state.error.stack}
                            </div>
                          )}
                        </code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={this.handleReset}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try Again
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
