// Touch screens in the 3D view, pure: which panels give text selection and scrolling back. touchMode.ts applies it to
// the page.

import type { Overlay } from '../store';

/** Panels that hold text to read, copy or type (terminals, the Kanban, the viewer, consoles, the phone): selection
 * and normal touch scrolling come back while one is open. The elevator panel and the shop's boxes stay game-like. */
export function selectableWindow(overlay: Overlay | null): boolean {
  if (!overlay) return false;
  return overlay.kind !== 'elevator' && overlay.kind !== 'catalogue' && overlay.kind !== 'decor-box';
}
