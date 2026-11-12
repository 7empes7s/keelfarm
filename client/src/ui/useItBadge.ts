// IT's badge from the store (#580): itBadge.ts's count, recomputed when IT's checks or cards change.
import { useStore } from '../store';
import { itWaiting } from './itBadge';

export const useItBadge = () => useStore((s) => itWaiting(s.itWatch, s.itImprove, Date.now()).total);

/** Opens the IT department's page: Settings → The IT department, in the 3D office's console or pocket mode's. */
export const openIt = () => useStore.getState().openOverlay({ kind: 'manager', tab: 'it-dept' });
