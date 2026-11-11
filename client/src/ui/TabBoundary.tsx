// Around a tab's body (#351): a render error shows "This tab couldn't load", why, and Retry, in the tab, instead of
// unmounting the whole office into a blank page.
import { Component, type ReactNode } from 'react';
import { Icon } from './Icon';

export class TabBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    console.warn("A tab couldn't load:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card" role="alert">
        <h3>
          <Icon name="triangle-alert" /> This tab couldn't load
        </h3>
        <p className="muted small">{error.message || 'Unknown error'}</p>
        <button type="button" className="ds-btn" onClick={() => this.setState({ error: null })}>
          <Icon name="rotate-ccw" /> Retry
        </button>
      </div>
    );
  }
}
