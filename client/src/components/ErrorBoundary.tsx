import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ui/States';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected application error.',
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Client logs must never include tokens; the message is UI-only.
    // eslint-disable-next-line no-console
    console.error('UI error boundary:', error.name, info.componentStack?.split('\n')[1]?.trim());
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-lg p-8">
          <ErrorState
            title="The dashboard hit an unexpected error"
            message={this.state.message}
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
