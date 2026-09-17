import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The thing that stands between one bad render and a white screen.
 *
 * React unmounts the entire tree when a render throws and nothing catches it.
 * This app had no boundary anywhere, so a single undefined property in one
 * panel — a card with no photo, a malformed date, a field the API stopped
 * sending — took the whole console down to a blank page with no message, no
 * recovery, and nothing in front of the operator to say what happened or what to
 * do. On a warehouse bench, mid-intake, that is indistinguishable from the
 * machine being broken.
 *
 * A class component because that is the only way to catch a render error in
 * React; there is no hook for it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not swallow the error. The failure
 * is re-thrown to the console and, once a reporter is wired, to that — because a
 * boundary that hides a crash from developers while showing a tidy message to
 * users is worse than the white screen it replaced.
 */
interface Props {
  children: ReactNode;
  /** Named in the fallback so a person can say WHICH part failed. */
  area?: string;
  /** Report hook — wire to Sentry (or whatever) when one exists. */
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
     * Two actions, because there are two different situations.
     *
     * "Try again" re-renders the subtree — which is the right move when the
     * failure came from data that has since changed, and costs nothing when it
     * does not. "Reload" throws the whole page state away, which is what
     * actually helps when the component's props are the problem.
     *
     * No stack trace on screen. It is in the console for whoever can read it,
     * and on a bench it would be noise between the operator and the button they
     * need.
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
          <button type="button" className="btn btn-gold" onClick={this.reset}>
            Try again
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
