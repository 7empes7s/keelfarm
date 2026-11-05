// Touch screens in the 3D view, pure: which panels give text selection and scrolling back, and whether a tap slid off
// the button it started on. touchMode.ts applies them to the page.

import type { Overlay } from '../store';

/** Panels that hold text to read, copy or type (terminals, the Kanban, the viewer, consoles, the phone): selection
 * and normal touch scrolling come back while one is open. The elevator panel and the shop's boxes stay game-like. */
export function selectableWindow(overlay: Overlay | null): boolean {
  if (!overlay) return false;
  return overlay.kind !== 'elevator' && overlay.kind !== 'catalogue' && overlay.kind !== 'decor-box';
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A finger lifting outside the box (with a few pixels' grace) slid off the button: its tap doesn't fire. */
export const slidOff = (box: Box, x: number, y: number, grace = 8) => x < box.left - grace || x > box.right + grace || y < box.top - grace || y > box.bottom + grace;
