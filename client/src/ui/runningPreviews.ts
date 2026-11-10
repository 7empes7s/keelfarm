// The menu's Previews badge (#226), apart from the lazy Previews page so the menu doesn't load the page with it.
import { useStore } from '../store';
import { previewsStats } from './previewGroups';

/** Previews starting or running, for the menu's badge. */
export function useRunningPreviews(): number {
  return useStore((s) => {
    const st = previewsStats(s.repos, s.prPreviews);
    return st.used + st.mainUp;
  });
}
