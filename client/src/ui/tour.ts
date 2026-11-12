// The tour's state on this device (#121): which steps it has seen (for "What's new"), a What's new replay in progress,
// and whether pocket mode's tour was started. The full tour's place is the office's settings.tutorialStep.
import { create } from 'zustand';
import { useStore } from '../store';
import { markSeen, seenIds, whatsNew, type TourStep, type Track } from './tourSteps';

const SEEN_KEY = 'cubefarm:tour-seen';

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

interface TourState {
  /** The saved seen list as stored (null: never saved on this device). */
  raw: string | null;
  /** The track this device is on, set by the tour as it shows. */
  track: Track;
  /** A What's new replay: its steps' ids and where it is. */
  replay: { ids: string[]; at: number } | null;
  /** Pocket mode only starts the full tour when asked (its invite card, Settings). */
  pocketTour: boolean;
  /** The tour or What's new is on screen: toasts wait behind it (#408). */
  on: boolean;
  /** A task tutorial is on screen (#517): toasts wait behind it too. */
  task: boolean;
  /** Pocket mode's way back from a page the tour opened (#408): remembers what's on screen, returns its restore. */
  keepPage: (() => () => void) | null;
}

export const useTour = create<TourState>(() => ({ raw: typeof window === 'undefined' ? null : readSeen(), track: 'office', replay: null, pocketTour: false, on: false, task: false, keepPage: null }));

/** The steps this device has seen. */
export const seenNow = (raw: string | null) => seenIds(raw, useStore.getState().settings.tutorialStep === -1);

/** Remembers `steps` as seen on this device. */
export function saveSeen(steps: readonly TourStep[]) {
  const raw = JSON.stringify(markSeen(seenNow(useTour.getState().raw), steps));
  try {
    localStorage.setItem(SEEN_KEY, raw);
  } catch {
    // remembered for this visit only
  }
  useTour.setState({ raw });
}

/** Replays `steps` (What's new), or what's new on this device's track. */
export function openWhatsNew(steps: readonly TourStep[] = whatsNew(useTour.getState().track, seenNow(useTour.getState().raw))) {
  if (steps.length) useTour.setState({ replay: { ids: steps.map((s) => s.id), at: 0 } });
}
