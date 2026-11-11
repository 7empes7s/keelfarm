// Where the tour's ring and card go, and which page a step opens (#408). Pure: Tutorial.tsx measures and draws.
import type { TourPage } from './tourSteps';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The CSS width of the probe `toVisual` is told about. */
export const PROBE_PX = 100;

/**
 * A control's rect where it's drawn on screen. Inside the UI scale's CSS zoom, WebKit (every iPhone browser) reports
 * rects in the zoomed box's own px, Chromium in the screen's: `probe`, the reported width of a PROBE_PX wide box in the
 * same zoom, tells which.
 */
export function toVisual(r: Box, probe: number, zoom: number): Box {
  if (zoom === 1 || Math.abs(probe - PROBE_PX * zoom) <= Math.abs(probe - PROBE_PX)) return r;
  const z = (n: number) => Math.round(n * zoom * 100) / 100;
  return { left: z(r.left), top: z(r.top), width: z(r.width), height: z(r.height) };
}

/** The first candidate on screen that isn't one of the tour card's own buttons and isn't under something else. */
export function pickSpot(candidates: readonly { box: Box; inCard: boolean; covered: boolean }[]): Box | null {
  return candidates.find((c) => c.box.width > 0 && c.box.height > 0 && !c.inCard && !c.covered)?.box ?? null;
}

/** The card's place: clear of its target (above one low on the screen), centred when its target isn't on screen. */
export function cardPlace(target: Box | null, pointsSomewhere: boolean, viewHeight: number): 'top' | 'bottom' | 'center' {
  if (!target) return pointsSomewhere ? 'center' : 'bottom';
  return target.top + target.height / 2 > viewHeight * 0.55 ? 'top' : 'bottom';
}

/**
 * Moving from a step on page `from` to one on `to`: open `to`, and put back the page the tour started from (`restore`)
 * once a step needs none. Between two pages the first one's way back is kept, so Back and Done land where it began.
 */
export function stageChange(from: TourPage | undefined, to: TourPage | undefined): { restore: boolean; open: TourPage | null } {
  return { restore: !!from && !to, open: to && to !== from ? to : null };
}
