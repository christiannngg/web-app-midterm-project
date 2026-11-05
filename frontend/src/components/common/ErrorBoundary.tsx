import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches errors thrown while rendering, so one broken component shows a message instead of a
 * blank page. (It can't catch errors in event handlers or promises: the API client reports those
 * as toasts.) App remounts it on every navigation, so moving to another page clears the error.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main role="alert">
        <h1>Something went wrong</h1>
        <p>
          This page hit an unexpected error. You can try again, or go back to the start. If you are
          in a game, your seat is kept: reopening the game takes you back to it.
        </p>
        {import.meta.env.DEV && <pre className="error-detail">{error.message}</pre>}
        <div className="toolbar">
          <button type="button" onClick={this.reset}>
            Try again
          </button>
          {/* A plain link on purpose: this boundary can sit outside the router. */}
          <a className="button secondary" href="/">
            Back to home
          </a>
        </div>
      </main>
    );
  }
}
