// The floor picker's pure parts (#412): each floor's plate tint from its 3D theme, and keeping the picked plate in view.
import { FLOOR_THEME_INFO, floorThemeOf } from '../../../shared/floorThemes';

/** The colour a floor's plate is tinted with: its 3D theme's main colour (the plain office for an unknown one). */
export const plateTint = (theme: unknown): string => FLOOR_THEME_INFO[floorThemeOf(theme)].swatch[1];

/** The row's scrollLeft that shows the plate at [start, start + width) whole, moving as little as possible (a plate wider than the row shows its start). */
export function scrollToShow(scrollLeft: number, viewWidth: number, start: number, width: number): number {
  if (start < scrollLeft || width > viewWidth) return Math.max(0, start);
  if (start + width > scrollLeft + viewWidth) return start + width - viewWidth;
  return scrollLeft;
}
