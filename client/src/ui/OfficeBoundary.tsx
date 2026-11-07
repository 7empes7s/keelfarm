// Around the lazy 3D office (#79): a chunk that won't load (a stale build after an update, a dropped connection) or a
// mount error (no WebGL) shows why, with Try again and Back to pocket, instead of a blank page.
import { Component, type ReactNode } from 'react';
import { bootDone } from '../pocket/officeBoot';
import { setMode } from '../pocket/mode';
import { Icon } from './Icon';

/** A dynamic import that failed: retrying the same URL won't help, a fresh page load gets the current build. */
const chunkFailed = (err: Error) => /dynamically imported module|importing a module script failed|failed to fetch|error loading/i.test(err.message);

export class OfficeBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    console.warn('The 3D office could not open:', error);
    bootDone(); // shown on screen: not a crash to warn about next time
  }

  private retry = () => {
    const { error } = this.state;
    if (error && chunkFailed(error)) {
      location.reload();
      return;
    }
    this.setState({ error: null });
    this.props.onRetry();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="office-failed" role="alert">
        <h2>The 3D office couldn't open on this device</h2>
        <p className="muted">{error.message || 'Unknown error'}</p>
        <div className="office-failed-actions">
          <button className="btn" onClick={this.retry}>
            Try again
          </button>
          <button className="btn btn-good" onClick={() => setMode('pocket')}>
            <Icon name="smartphone" /> Back to pocket
          </button>
        </div>
      </div>
    );
  }
}
