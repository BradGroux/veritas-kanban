import React, { Component, ReactNode } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { UiAction, UiHeading } from '@/components/ui/UiVocabulary';
import { SettingsGroup, SettingsNotice } from './SettingsLayout';

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
          <SettingsNotice tone="error">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2">
                <UiHeading order={3}>This section failed to load</UiHeading>
                <p className="text-sm">
                  The {this.props.tabName} tab encountered an unexpected error and couldn't render
                  properly.
                </p>

                {this.state.error && (
                  <div className="pt-2">
                    <UiAction
                      onClick={this.toggleErrorDetails}
                      variant="quiet"
                      leftSection={
                        this.state.errorExpanded ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      }
                    >
                      {this.state.errorExpanded ? 'Hide' : 'Show'} error details
                    </UiAction>

                    {this.state.errorExpanded && (
                      <SettingsGroup className="mt-2">
                        <code className="text-xs break-all whitespace-pre-wrap">
                          {this.state.error.message}
                          {this.state.error.stack && (
                            <div className="mt-2 text-muted-foreground text-[10px] leading-relaxed">
                              {this.state.error.stack}
                            </div>
                          )}
                        </code>
                      </SettingsGroup>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <UiAction
                onClick={this.handleReset}
                variant="secondary"
                leftSection={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Try Again
              </UiAction>
            </div>
          </SettingsNotice>
        </div>
      );
    }

    return this.props.children;
  }
}
