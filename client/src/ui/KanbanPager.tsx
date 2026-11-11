// A Kanban column's pager (#411): ‹ 1 … 4 5 6 … 16 › over "61–80 of 312", and the Merged column's older pages,
// asked of the server once per page and newest merge (it fetches them from GitHub once too).
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MergedPage } from '../../../shared/types';
import { Icon } from './Icon';
import { pageCount, pagerItems, rangeText } from './kanbanPages';
import './kanbanPager.css';

export function KanbanPager({ label, page, total, onPage }: { label: string; page: number; total: number; onPage: (page: number) => void }) {
  const pages = pageCount(total);
  return (
    <nav className="kpager" aria-label={`${label} pages`}>
      <div className="kpager-row">
        <button type="button" className="btn btn-small kpager-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <Icon name="chevron-left" />
        </button>
        {pagerItems(page, pages).map((it, i) =>
          'gap' in it ? (
            <span key={`gap-${i}`} className="kpager-gap" aria-hidden="true">…</span>
          ) : (
            <button
              key={it.n}
              type="button"
              className={`btn btn-small kpager-btn kpager-num ${it.near ? '' : 'kpager-far'}`}
              aria-label={`Page ${it.n}`}
              aria-current={it.n === page ? 'page' : undefined}
              onClick={() => onPage(it.n)}
            >
              {it.n}
            </button>
          ),
        )}
        <button type="button" className="btn btn-small kpager-btn" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <Icon name="chevron-right" />
        </button>
      </div>
      <span className="kpager-count small muted" aria-live="polite">{rangeText(page, total)}</span>
    </nav>
  );
}

const fetched = new Map<string, MergedPage>();

/**
 * Page `page` of a floor's merged PRs while the newest is `latest` (null: none wanted). Kept for the visit, so going
 * back and forth asks once; a new merge shifts every page, so it asks again.
 */
export function useMergedPage(repoId: string, latest: number, page: number | null): { data?: MergedPage; failed?: string } {
  const key = page == null ? null : `${repoId}#${latest}#${page}`;
  const [got, setGot] = useState<{ key: string; data?: MergedPage; failed?: string } | null>(null);
  useEffect(() => {
    if (key == null || page == null || fetched.has(key)) return;
    let live = true;
    api.mergedPage(repoId, page).then(
      (data) => {
        fetched.set(key, data);
        if (live) setGot({ key, data });
      },
      (err: Error) => live && setGot({ key, failed: err.message }),
    );
    return () => void (live = false);
  }, [key, repoId, page]);
  if (key == null) return {};
  const cached = fetched.get(key);
  if (cached) return { data: cached };
  return got?.key === key ? got : {};
}
