// Where the toasts go (#230), pure: never over a panel's header or a tab row. On a computer and in the 3D office they
// stack top right under the header; on a phone at the bottom, over the composer and the tab bar (#107). Safe areas and
// the docked CEO chat column (#212) are kept clear.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ToastSpace {
  /** The viewport, px. */
  vw: number;
  vh: number;
  /** The stack's size, px. */
  width: number;
  height: number;
  /** Which end they start from: the top on computers, the bottom on phones. */
  from: 'top' | 'bottom';
  /** Safe areas, px. */
  safe: { top: number; right: number; bottom: number; left: number };
  /** The left edge of a column docked on the right (the CEO chat), px; the toasts stay left of it. */
  dockLeft?: number | null;
  /** Panel headers, tab rows, the app's header, the composer and the tab bar on screen. */
  avoid: Box[];
}

/** The gap kept from edges and from what they avoid, px. */
export const TOAST_GAP = 12;

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Phones: the stack starts from the bottom. */
export const toastsFrom = (vw: number): ToastSpace['from'] => (vw <= 600 ? 'bottom' : 'top');

/** The stack's top-left corner, px. */
export function placeToasts(s: ToastSpace): { left: number; top: number } {
  const g = TOAST_GAP;
  const right = Math.min(s.vw - s.safe.right, s.dockLeft ?? Infinity) - g;
  const left = Math.max(s.safe.left + g, right - s.width);
  const w = right - left;
  const minTop = s.safe.top + g;
  const maxTop = s.vh - s.safe.bottom - g - s.height;
  const box = (top: number): Box => ({ left, top, right: left + w, bottom: top + s.height });

  // Down from the top, stepping under whatever it would cover; or up from the bottom, stepping over it. Each step
  // goes only as far as the boxes it hits, so a free spot is never skipped: if none is found, there is none.
  const down = s.from === 'top';
  let top = down ? minTop : maxTop;
  for (let i = 0; i <= s.avoid.length; i++) {
    const hit = s.avoid.filter((b) => overlaps(box(top), b));
    if (!hit.length) break;
    top = down ? Math.max(...hit.map((b) => b.bottom)) + g : Math.min(...hit.map((b) => b.top)) - g - s.height;
  }
  // No room anywhere (a very tall stack): its own end, on screen.
  if (top < minTop || top > maxTop) top = down ? minTop : Math.max(minTop, maxTop);
  return { left, top };
}
