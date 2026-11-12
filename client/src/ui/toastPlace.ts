// Where the toasts go (#230, #521), pure: they drop in at the top on every screen, like a phone's banner: just under
// the safe area and the bars at the top (the app's header, a panel's header and tab row), top right on a computer, and
// stay there. They never step down mid-screen to dodge things, and never reach down over what's below them (the
// composer, the text box being typed in, the tab bar): the stack only gets the room above it. Safe areas and the
// docked CEO chat column (#212) are kept clear.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ToastSpace {
  /** The visible part of the page, px (the keyboard and browser bars taken off). */
  vw: number;
  vh: number;
  /** Where the visible part starts, px (iOS scrolls the page under the keyboard). */
  viewTop?: number;
  /** The stack's size, px. */
  width: number;
  height: number;
  /** Safe areas, px. */
  safe: { top: number; right: number; bottom: number; left: number };
  /** The left edge of a column docked on the right (the CEO chat), px; the toasts stay left of it. */
  dockLeft?: number | null;
  /** What they never cover: headers and tab rows (stepped under at the top), the composer, the focused field, the tab bar. */
  avoid: Box[];
}

/** The gap kept from edges and from what they avoid, px. */
export const TOAST_GAP = 12;

/** How far down bars at the top may push the stack, as a share of the visible height: never mid-screen. */
const TOP_BAND = 1 / 3;

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The stack's top-left corner and the room it has down to the first thing under it, px (0: no room, wait). */
export function placeToasts(s: ToastSpace): { left: number; top: number; room: number } {
  const g = TOAST_GAP;
  const y0 = s.viewTop ?? 0;
  const right = Math.min(s.vw - s.safe.right, s.dockLeft ?? Infinity) - g;
  const left = Math.max(s.safe.left + g, right - s.width);
  const w = right - left;
  const minTop = y0 + s.safe.top + g;
  const box = (top: number): Box => ({ left, top, right: left + w, bottom: top + s.height });

  // Down from the top, stepping under the bars it would cover; each step goes only as far as the boxes it hits, so a
  // free spot is never skipped. Past the top band it stays under the first bars (the app's header) instead.
  let top = minTop;
  let first: number | null = null;
  for (let i = 0; i <= s.avoid.length; i++) {
    const hit = s.avoid.filter((b) => overlaps(box(top), b));
    if (!hit.length) break;
    top = Math.max(...hit.map((b) => b.bottom)) + g;
    first ??= top;
  }
  if (top > y0 + s.vh * TOP_BAND) top = first !== null && first <= y0 + s.vh * TOP_BAND ? first : minTop;

  const under = s.avoid.filter((b) => b.left < left + w && left < b.right && b.bottom > top).map((b) => b.top);
  const room = Math.max(0, Math.min(y0 + s.vh - s.safe.bottom, ...under) - g - top);
  return { left, top, room };
}
