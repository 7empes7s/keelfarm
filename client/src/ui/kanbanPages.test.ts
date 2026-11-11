import { describe, expect, it } from 'vitest';
import { clampPage, PAGE_SIZE, pageCount, pagerItems, pageSlice, parsePages, rangeText, withPage } from './kanbanPages';

describe('Kanban pages (#411)', () => {
  it('cuts a column into pages of 20, keeping its order', () => {
    expect(PAGE_SIZE).toBe(20);
    const cards = Array.from({ length: 45 }, (_, i) => 100 - i); // newest first
    expect(pageSlice(cards, 1)).toEqual(cards.slice(0, 20));
    expect(pageSlice(cards, 2)[0]).toBe(80);
    expect(pageSlice(cards, 3)).toEqual([60, 59, 58, 57, 56]);
    expect(pageCount(45)).toBe(3);
    expect(pageCount(40)).toBe(2);
    expect(pageCount(0)).toBe(1);
  });

  it('keeps the page in range', () => {
    expect(clampPage(5, 45)).toBe(3);
    expect(clampPage(0, 45)).toBe(1);
    expect(clampPage(Number.NaN, 45)).toBe(1);
    expect(clampPage(2, 45)).toBe(2);
  });

  it('says which cards a page shows', () => {
    expect(rangeText(2, 312)).toBe('21–40 of 312');
    expect(rangeText(1, 312)).toBe('1–20 of 312');
    expect(rangeText(16, 312)).toBe('301–312 of 312');
    expect(rangeText(1, 0)).toBe('0 of 0');
  });

  it('numbers the first, the last and the pages around this one', () => {
    const show = (page: number, pages: number) => pagerItems(page, pages).map((it) => ('gap' in it ? '…' : it.near ? `${it.n}` : `(${it.n})`)).join(' ');
    expect(show(5, 16)).toBe('(1) … 4 5 6 … (16)');
    expect(show(1, 16)).toBe('1 2 … (16)');
    expect(show(16, 16)).toBe('(1) … 15 16');
    expect(show(2, 3)).toBe('1 2 3');
    expect(show(3, 5)).toBe('(1) 2 3 4 (5)');
    expect(show(1, 1)).toBe('1');
  });

  it('remembers the page per floor and column, ignoring junk', () => {
    const map = withPage(withPage({}, 'o/a', 'merged', 3), 'o/b', 'backlog', 2);
    expect(parsePages(JSON.stringify(map))).toEqual({ 'o/a': { merged: 3 }, 'o/b': { backlog: 2 } });
    expect(parsePages('{"o/a":{"merged":0,"qa":"2","ready":2.5,"backlog":4}}')).toEqual({ 'o/a': { backlog: 4 } });
    expect(parsePages('nope')).toEqual({});
    expect(parsePages(null)).toEqual({});
  });
});
