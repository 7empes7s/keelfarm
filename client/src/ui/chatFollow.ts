// Whether the CEO chat keeps following its newest message (#152). Pure, so it's tested without a page.

/**
 * After a scroll of the log: at the end it follows; only a scroll up leaves the end. The log shrinking under the
 * keyboard (or the stack above it changing) fires scrolls that aren't at the end for a moment but didn't go up.
 */
export function keepsFollowing(following: boolean, top: number, lastTop: number, atEnd: boolean): boolean {
  if (atEnd) return true;
  return top < lastTop ? false : following;
}
