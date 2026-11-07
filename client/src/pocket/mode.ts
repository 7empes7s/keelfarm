// Which office this device gets: the 3D one, or pocket mode (2D, for phones and touch screens; docs/pocket.md).
// ?pocket=1 / ?pocket=0 decide for one visit; a choice made in the app is remembered on this device.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { bootDone, bootStep, takeCrash } from './officeBoot';

export type ViewMode = 'pocket' | 'office';

/** Pocket mode's layout (#104): the phone's (bottom tabs), a rail with icons and a chat drawer, or rail, pages and chat side by side. */
export type PocketLayout = 'compact' | 'medium' | 'expanded';

/** Widest phone layout, narrowest touch tablet's rail and narrowest expanded one, in CSS px. */
const COMPACT_MAX = 760;
const TABLET_MIN = 768;
const TABLET_HEIGHT = 600;
const EXPANDED_MIN = 1024;

/**
 * The layout for a window `width` x `height` px; a touch-only screen keeps the phone's layout until it's a tablet's
 * (768 px wide and 600 tall: an iPad upright gets the rail and the chat drawer, #212; a phone on its side doesn't).
 */
export function pickLayout(x: { width: number; height: number; touch: boolean }): PocketLayout {
  if (x.width >= EXPANDED_MIN) return 'expanded';
  if (x.width <= COMPACT_MAX) return 'compact';
  return x.touch && (x.width < TABLET_MIN || x.height < TABLET_HEIGHT) ? 'compact' : 'medium';
}

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

/** The other office: what the 2D / 3D switch (and its key) goes to. */
export const otherMode = (mode: ViewMode): ViewMode => (mode === 'pocket' ? 'office' : 'pocket');

/** Pocket mode's layout for this window, following resizes (in the UI scale's px, like the page's CSS). */
export function useLayout(): PocketLayout {
  const read = () => {
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    return pickLayout({ width: window.innerWidth / scale, height: window.innerHeight / scale, touch: matchMedia('(hover: none) and (pointer: coarse)').matches });
  };
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const onResize = () => setLayout(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}
