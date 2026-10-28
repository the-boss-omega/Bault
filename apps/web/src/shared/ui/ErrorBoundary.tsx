import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './primitives';

interface Props {
  children: ReactNode;
  area?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[bault] render failed', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <h2>Something on this screen stopped working</h2>
        <p>
          {this.props.area
            ? `The ${this.props.area} could not be displayed. Nothing you did was lost — this is a fault in the page, not in your work.`
            : 'This part of the page could not be displayed. Nothing you did was lost — this is a fault in the page, not in your work.'}
        </p>
        <p className="error-boundary-detail">{error.message}</p>
        <div className="error-boundary-actions">
          <Button variant="primary" onClick={this.reset}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      </div>
    );
  }
}
