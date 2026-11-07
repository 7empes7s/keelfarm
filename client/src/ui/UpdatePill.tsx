// The header's "New version · Update" (#216): shown while the office runs a newer version than this page. A tap
// loads it, unless something is being written, uploaded or sent; then it says so and waits for the next safe moment.
import { useStore } from '../store';
import { loadUpdate } from '../clientUpdate';

export function UpdatePill() {
  const ready = useStore((s) => s.updateReady);
  if (!ready) return null;
  return (
    <button className="btn btn-small btn-good update-pill" onClick={() => void loadUpdate('tap')} title="A new version of the office is ready. It also loads by itself when you switch tabs, never while you're writing">
      New version · Update
    </button>
  );
}
