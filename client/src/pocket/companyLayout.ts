// The Company page's layout decisions (#223), pure: how many columns the floor cards get in the width the page has
// (the chat open or closed and the browser's zoom only change that width), and the one status row while the office
// connects, updates or restarts.
import type { IconName } from '../ui/icons';

/** A floor card is at least this wide; a little narrower (SOFT_MIN) only to keep a card from sitting alone in a row. */
export const FLOOR_MIN = 340;
const SOFT_MIN = 300;

const fits = (width: number, min: number, gap: number) => Math.max(1, Math.floor((width + gap) / (min + gap)));
const lonely = (count: number, cols: number) => count > cols && count % cols === 1;
/** The fewest columns that still fill the same number of rows: 4 cards in room for 3 make 2 + 2, not 3 + 1. */
const balance = (count: number, cols: number) => Math.ceil(count / Math.ceil(count / cols));

/** The floor grid's column count for `count` cards in `width` px: cards ≥ FLOOR_MIN, and no card alone in its row
 *  when one more column (cards ≥ SOFT_MIN) gives a balanced split. */
export function floorColumns(width: number, count: number, gap = 12): number {
  if (count <= 1 || !(width > 0)) return 1;
  const cols = balance(count, Math.min(count, fits(width, FLOOR_MIN, gap)));
  if (!lonely(count, cols)) return cols;
  const more = balance(count, Math.min(count, cols + 1));
  return more > cols && more <= fits(width, SOFT_MIN, gap) && !lonely(count, more) ? more : cols;
}

export interface StatusInput {
  connected: boolean;
  /** The first snapshot arrived (else it's the first connection). */
  loaded: boolean;
  /** The office said it's restarting to update, or the drop came while an update was on its way. */
  restarting: boolean;
  /** The update chip (officeUpdateChip), or null. */
  update: string | null;
}

/** One status line at a time: "Updating the office…" while it updates, "Back in a moment…" while it restarts, a
 *  reconnect only when the drop wasn't expected. Null when there's nothing to say. */
export function statusLine({ connected, loaded, restarting, update }: StatusInput): { text: string; bad: boolean; icon?: IconName } | null {
  if (!connected && restarting) return { text: 'Back in a moment…', bad: false, icon: 'refresh-cw' };
  if (!connected) return { text: loaded ? 'Reconnecting to the office…' : 'Connecting to the office…', bad: true, icon: 'radio-tower' };
  return update ? { text: update, bad: false } : null;
}
