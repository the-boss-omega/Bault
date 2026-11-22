import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError, type ErrorReporter } from '../errorReporting';

export const APP_FAILURE_SENTENCE =
  'Something went wrong on our side. Reload the page; if it keeps happening, tell support.';

interface Props {
  children: ReactNode;
  report?: ErrorReporter;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    (this.props.report ?? reportError)(error, { componentStack: info.componentStack });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p>{APP_FAILURE_SENTENCE}</p>
      </div>
    );
  }
}
