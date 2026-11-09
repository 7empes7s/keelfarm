// The preview viewer's toolbar on a phone (#294), pure: which actions fit in its one row at the width it has, and in
// which form; whatever doesn't fit goes into ⋯, never cut off or scrolling sideways.

/** Start/Stop and ⋯ always show; these join them when there's room, most wanted first. */
export type BarAction = 'widths' | 'side' | 'reload';

/** `full`: icons and labels; `compact`: icons (or short labels) only; `menu`: in ⋯. */
export type BarForm = 'full' | 'compact' | 'menu';

/** Px each action takes in the row and its 6 px gap, in the layout's own px (pocket mode's UI scale doesn't change them). */
const BAR_PX: Record<BarAction, { full: number; compact: number }> = {
  widths: { full: 162, compact: 100 },
  side: { full: 130, compact: 100 },
  reload: { full: 110, compact: 110 }, // Reload joins only in full
};

/** Start/Stop, ⋯ and the gaps around the spacer between them. */
const BAR_FIXED_PX = 144;

/**
 * What the row grows by, in turn: compare's side switch first (comparing is switching sides), the Mobile | Desktop
 * toggle, their labels, then Reload.
 */
const STEPS: [BarAction, Exclude<BarForm, 'menu'>][] = [
  ['side', 'compact'],
  ['widths', 'compact'],
  ['widths', 'full'],
  ['side', 'full'],
  ['reload', 'full'],
];

/** The form of each wanted action in a row `width` px wide, taking STEPS in turn while each fits; the rest are in ⋯. */
export function barFit(width: number, wanted: BarAction[]): Record<BarAction, BarForm> {
  const out: Record<BarAction, BarForm> = { widths: 'menu', side: 'menu', reload: 'menu' };
  let left = width - BAR_FIXED_PX;
  for (const [a, form] of STEPS) {
    if (!wanted.includes(a)) continue;
    const more = BAR_PX[a][form] - (out[a] === 'menu' ? 0 : BAR_PX[a].compact);
    if (more > left) continue;
    out[a] = form;
    left -= more;
  }
  return out;
}
