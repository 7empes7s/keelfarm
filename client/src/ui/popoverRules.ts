// Header popovers (#416), the pure part: where a popover goes under the button that opened it. Popover.tsx draws it.
import type { Box } from './hoverRules';

/** Kept between a popover and the window's edges. */
export const EDGE = 12;
/** The arrow's tip stays this far inside the card's corners (its rounding). */
const ARROW_INSET = 16;

export interface Anchored {
  left: number;
  top: number;
  /** Under the trigger ('bottom') or, when only above has room, over it ('top'). */
  side: 'top' | 'bottom';
  /** The arrow's tip, from the card's left edge: at the trigger's centre. */
  arrow: number;
  /** The room it has on its side: taller content scrolls inside. */
  maxHeight: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Where a `w`×`h` popover goes for a `trigger` in a `vw`×`vh` window: under it (over it only when below has no room
 * and above has more), centred on it or right-aligned with it (`end`), slid to stay `margin` inside the window. Unlike
 * a hover card it never moves off the CEO chat: it's on the top layer, and it stays at its button.
 */
export function placeAnchored(trigger: Box, w: number, h: number, vw: number, vh: number, align: 'center' | 'end' = 'center', gap = 10, margin = EDGE): Anchored {
  const below = vh - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const side = below >= h || below >= above ? 'bottom' : 'top';
  const room = Math.max(0, side === 'bottom' ? below : above);
  const height = Math.min(h, room);
  const top = side === 'bottom' ? trigger.bottom + gap : trigger.top - gap - height;
  const mid = (trigger.left + trigger.right) / 2;
  const left = clamp(align === 'end' ? trigger.right - w : mid - w / 2, margin, vw - margin - w);
  const arrow = clamp(mid - left, Math.min(ARROW_INSET, w / 2), w - Math.min(ARROW_INSET, w / 2));
  return { left, top, side, arrow, maxHeight: room };
}
