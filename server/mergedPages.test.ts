import { describe, expect, it, vi } from 'vitest';
import { MergedPages, MERGED_PAGES_MAX } from './mergedPages.ts';
import type { MergedPage } from '../shared/types.ts';

const pageOf = (page: number): MergedPage => ({ page, total: 312, pulls: [] });

describe('MergedPages', () => {
  it('fetches a page once and serves it from the cache after', async () => {
    const cache = new MergedPages();
    const fetch = vi.fn(async (p: number) => pageOf(p));
    expect((await cache.get('o/r', 90, 2, fetch)).page).toBe(2);
    await cache.get('o/r', 90, 2, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    await cache.get('o/r', 90, 3, fetch);
    await cache.get('o/other', 90, 2, fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fetches again after a new merge, and after a failed read', async () => {
    const cache = new MergedPages();
    const fetch = vi.fn(async (p: number) => pageOf(p));
    await cache.get('o/r', 90, 2, fetch);
    await cache.get('o/r', 91, 2, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    const failing = vi.fn(async () => {
      throw new Error('502');
    });
    await expect(cache.get('o/r', 91, 4, failing)).rejects.toThrow('502');
    await cache.get('o/r', 91, 4, fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps pages within GitHub's search", async () => {
    const cache = new MergedPages();
    const fetch = vi.fn(async (p: number) => pageOf(p));
    expect((await cache.get('o/r', 1, 0, fetch)).page).toBe(1);
    expect((await cache.get('o/r', 1, 999, fetch)).page).toBe(MERGED_PAGES_MAX);
  });
});
