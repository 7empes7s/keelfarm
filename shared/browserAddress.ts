// An agent's browser address (#230): the last page their browser showed, kept through screenshots that don't say
// which page they are of (a Playwright screenshot without a navigation, a lab shot before one).

/** The address after a screenshot or a navigation: its page when it has one, else the last known one (null: unknown). */
export function knownUrl(last: string | null, page: string | null | undefined): string | null {
  const url = page?.trim();
  return url ? url : last;
}
