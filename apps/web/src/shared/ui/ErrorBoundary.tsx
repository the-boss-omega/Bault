import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './primitives';

/**
 * The thing that stands between one bad render and a white screen.
 *
 * React unmounts the entire tree when a render throws and nothing catches it.
 * This shows a message and a way to recover instead.
 *
 * A class component because that is the only way to catch a render error in
 * React; there is no hook for it.
 *
 * It does not swallow the error: the failure is logged to the console and
 * passed to `onError` when one is given.
 */
interface Props {
  children: ReactNode;
  /** Named in the fallback so a person can say which part failed. */
  area?: string;
  /** Report hook for an error reporter. */
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

    /**
     * "Try again" re-renders the subtree, which helps when the failure came from
     * data that has since changed. "Reload" throws the whole page state away,
     * which helps when the component's props are the problem.
     *
     * No stack trace on screen; it is in the console.
     */
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
          <Button variant="gold" onClick={this.reset}>
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
