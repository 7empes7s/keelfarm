// "New version · Update" (#216): the office updated itself and its client is ready, loaded on a tap (or at the next
// safe moment, updateLoad.ts) instead of a reload under the manager's fingers.
import { useStore } from '../store';
import { loadUpdate } from '../updateLoad';

export function UpdatePill({ className, short }: { className: string; short?: boolean }) {
  const ready = useStore((s) => s.updateReady !== null);
  if (!ready) return null;
  return (
    <button className={className} onClick={() => loadUpdate({ kind: 'tap' })} aria-label="New version · Update" title="The office updated itself: load its new version (your drafts are kept)">
      {short ? '⟳ Update' : 'New version · Update'}
    </button>
  );
}
