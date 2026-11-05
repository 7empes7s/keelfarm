// Which office this device gets: the 3D one, or pocket mode (2D, for phones and touch screens; docs/pocket.md).
// ?pocket=1 / ?pocket=0 decide for one visit; a choice made in the app is remembered on this device.
import { create } from 'zustand';
import { bootDone, bootStep, takeCrash } from './officeBoot';

export type ViewMode = 'pocket' | 'office';

const KEY = 'cubefarm:mode';

/**
 * The mode to start in: the URL's say, then pocket if the 3D office crashed while starting last time (so a phone it
 * crashes on isn't stuck in a reload loop), then this device's last choice, then pocket on narrow or touch-only screens.
 */
export function pickMode(x: { param: string | null; saved: string | null; narrow: boolean; touch: boolean; crashed?: boolean }): ViewMode {
  if (x.param !== null) return x.param === '0' || x.param === 'false' ? 'office' : 'pocket';
  if (x.crashed) return 'pocket';
  if (x.saved === 'pocket' || x.saved === 'office') return x.saved;
  return x.narrow || x.touch ? 'pocket' : 'office';
}

function remember(mode: ViewMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // remembered for this visit only
  }
}

function startMode(): { mode: ViewMode; closedLast: string | null } {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // no storage: decide from the screen
  }
  const closedLast = takeCrash();
  const mode = pickMode({
    param: new URLSearchParams(location.search).get('pocket'),
    saved,
    narrow: matchMedia('(max-width: 760px)').matches,
    touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
    crashed: closedLast !== null,
  });
  if (closedLast && mode === 'pocket') remember('pocket');
  if (mode === 'office') bootStep('loading the 3D office');
  return { mode, closedLast };
}

/** `closedLast`: why the 3D office closed while starting last time (pocket mode shows it), or null. */
export const useMode = create<{ mode: ViewMode; closedLast: string | null }>(() => (typeof window === 'undefined' ? { mode: 'office', closedLast: null } : startMode()));

/** Switches this device to `mode` and remembers it. */
export function setMode(mode: ViewMode) {
  remember(mode);
  if (mode === 'pocket') bootDone();
  else if (useMode.getState().mode !== 'office') bootStep('loading the 3D office');
  useMode.setState({ mode, closedLast: null });
}
