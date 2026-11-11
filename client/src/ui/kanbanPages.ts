// The Kanban's columns in pages (#411), pure: 20 cards a page, newest first, the pager's buttons, its "21–40 of 312"
// and the page the manager is on per floor and column (kept in sessionStorage `cubefarm:kanban-page` by KanbanView).
import { MERGED_LISTED } from '../../../shared/types';
import type { ColumnId } from './kanbanFold';

/** Cards on a page; the same as the merges the sync lists, so the Merged column's first page is the live one. */
export const PAGE_SIZE = MERGED_LISTED;

/** Every floor's pages, by repo id then column; a column not in it is on page 1. */
export type PageMap = Record<string, Partial<Record<ColumnId, number>>>;

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** `page` kept between 1 and the last page. */
export const clampPage = (page: number, total: number) => Math.min(pageCount(total), Math.max(1, Math.floor(page) || 1));

/** The cards of one page of a column that has them all. */
export const pageSlice = <T>(cards: T[], page: number): T[] => cards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

/** "21–40 of 312". */
export function rangeText(page: number, total: number): string {
  if (total <= 0) return '0 of 0';
  const first = (page - 1) * PAGE_SIZE + 1;
  return `${first}–${Math.min(total, page * PAGE_SIZE)} of ${total}`;
}

export type PagerItem = { n: number; near: boolean } | { gap: true };

/**
 * The pager's numbers: the first, the last and the pages either side of this one, with a gap where some are skipped,
 * e.g. 1 … 4 5 6 … 16. `near` ones are this page and its neighbours, which a narrow column keeps (kanbanPager.css).
 */
export function pagerItems(page: number, pages: number): PagerItem[] {
  const ns = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: PagerItem[] = [];
  for (const [i, n] of ns.entries()) {
    if (i > 0 && n - ns[i - 1] > 1) out.push({ gap: true });
    out.push({ n, near: Math.abs(n - page) <= 1 });
  }
  return out;
}

/** `map` with one column of one floor on `page`. */
export const withPage = (map: PageMap, repoId: string, id: ColumnId, page: number): PageMap => ({ ...map, [repoId]: { ...map[repoId], [id]: page } });

/** The saved pages, keeping only whole numbers from 1; anything unreadable is page 1. */
export function parsePages(raw: string | null): PageMap {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  const out: PageMap = {};
  if (!data || typeof data !== 'object') return out;
  for (const [repoId, cols] of Object.entries(data)) {
    if (!cols || typeof cols !== 'object') continue;
    out[repoId] = Object.fromEntries(Object.entries(cols).filter(([, v]) => Number.isInteger(v) && (v as number) >= 1));
  }
  return out;
}
