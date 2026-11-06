// Which office this device gets: the 3D one, or pocket mode (2D, for phones and touch screens; docs/pocket.md).
// ?pocket=1 / ?pocket=0 decide for one visit; a choice made in the app is remembered on this device.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { bootDone, bootStep, takeCrash } from './officeBoot';

export type ViewMode = 'pocket' | 'office';

/** Pocket mode's layout (#104): the phone's (bottom tabs), a rail with icons and a chat drawer, or rail, pages and chat side by side. */
export type PocketLayout = 'compact' | 'medium' | 'expanded';

/** Widest phone layout, and narrowest expanded one, in CSS px. */
const COMPACT_MAX = 760;
const EXPANDED_MIN = 1024;

/** The layout for a window `width` px wide; touch-only screens keep the phone's layout until they're expanded-wide (a tablet in landscape). */
export function pickLayout(x: { width: number; touch: boolean }): PocketLayout {
  if (x.width >= EXPANDED_MIN) return 'expanded';
  return x.width <= COMPACT_MAX || x.touch ? 'compact' : 'medium';
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
  const read = () => pickLayout({ width: window.innerWidth / (Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1), touch: matchMedia('(hover: none) and (pointer: coarse)').matches });
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const onResize = () => setLayout(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}
