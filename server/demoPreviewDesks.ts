// The demo's side of the previews' upkeep (#204): preview desks to measure and clean up, and people's own PRs left
// open for days, which fold under "Older" in the app viewer.
import type { PullInfo } from '../shared/types.ts';

const MB = 1024 * 1024;

/** Each floor's main preview desk, and a PR slot left over from a hard stop until a cleanup removes it. */
export function demoPreviewDesks() {
  const removed = new Set<string>(); // `${fullName}|${slug}`
  return {
    removeDesk: async (fullName: string, slug: string) => void removed.add(`${fullName}|${slug}`),
    previewDesks: async (fullName: string) =>
      [
        { slug: 'preview', bytes: 240 * MB },
        { slug: 'preview-pr-2', bytes: 310 * MB },
      ].filter((d) => d.slug === 'preview' || !removed.has(`${fullName}|${d.slug}`)),
  };
}

/** Open PRs last touched days ago (4, 7, 10 …), made from `pull` (a number and a title). */
export function stalePulls(titles: string[], pull: (title: string) => PullInfo): PullInfo[] {
  return titles.map((title, i) => {
    const at = new Date(Date.now() - (4 + i * 3) * 86_400_000).toISOString();
    const p = pull(title);
    return { ...p, headRefName: `wip/${p.number}`, state: 'OPEN', mergedAt: null, createdAt: at, updatedAt: at, author: 'demo-co' };
  });
}
