// The Merged column's older pages (#411): fetched from GitHub the first time a tab asks for one, then served from here
// until the floor merges something new (every page shifts by one then). The sync itself only lists the latest merges.
import type { MergedPage } from '../shared/types.ts';

/** GitHub's search returns at most 1000 results, so 50 pages of 20. */
export const MERGED_PAGES_MAX = 50;

export class MergedPages {
  private floors = new Map<string, { latest: number; pages: Map<number, Promise<MergedPage>> }>();

  /** Page `page` of a floor whose newest merged PR is `latest`, fetched once per newest merge. */
  get(repoId: string, latest: number, page: number, fetch: (page: number) => Promise<MergedPage>): Promise<MergedPage> {
    const n = Math.min(MERGED_PAGES_MAX, Math.max(1, Math.floor(page)));
    let floor = this.floors.get(repoId);
    if (!floor || floor.latest !== latest) this.floors.set(repoId, (floor = { latest, pages: new Map() }));
    const pages = floor.pages;
    let got = pages.get(n);
    if (!got) {
      got = fetch(n);
      pages.set(n, got);
      got.catch(() => pages.delete(n)); // a failed read is tried again next time
    }
    return got;
  }
}
