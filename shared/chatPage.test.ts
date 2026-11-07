import { describe, expect, it } from 'vitest';
import { anchoredTop, CHAT_KEEP, CHAT_PAGE, CHAT_PAGE_MAX, LOAD_OLDER_PX, pageBefore, removal, removeMessage, wantsOlder, withNewest, withOlder } from './chatPage.ts';
import type { PhoneMessage } from './types.ts';

const m = (id: number, from: PhoneMessage['from'] = 'manager', extra: Partial<PhoneMessage> = {}): PhoneMessage => ({ id, from, text: `#${id}`, at: id, ...extra });
const thread = (n: number) => Array.from({ length: n }, (_, i) => m(i + 1, i % 2 ? 'ceo' : 'manager'));
const ids = (ms: readonly PhoneMessage[]) => ms.map((x) => x.id);

describe('the chat in pages (#145)', () => {
  it('opens on the latest page, and says when there is more before it', () => {
    const page = pageBefore(thread(500));
    expect(page.messages).toHaveLength(CHAT_PAGE);
    expect(ids(page.messages).at(0)).toBe(500 - CHAT_PAGE + 1);
    expect(ids(page.messages).at(-1)).toBe(500);
    expect(page.older).toBe(true);
    expect(pageBefore(thread(CHAT_PAGE))).toEqual({ messages: thread(CHAT_PAGE), older: false });
  });

  it('walks back page by page to the first message, never twice', () => {
    const all = thread(130);
    let have = pageBefore(all).messages;
    let older = true;
    let pages = 1;
    while (older) {
      const page = pageBefore(all, have[0].id);
      have = withOlder(have, page.messages);
      older = page.older;
      pages++;
    }
    expect(pages).toBe(Math.ceil(130 / CHAT_PAGE));
    expect(ids(have)).toEqual(ids(all));
  });

  it('caps what one request may ask for, and leaves hidden messages out', () => {
    expect(pageBefore(thread(500), Infinity, 10_000).messages).toHaveLength(CHAT_PAGE_MAX);
    expect(pageBefore(thread(500), Infinity, Number.NaN).messages).toHaveLength(CHAT_PAGE);
    const withHidden = [m(1), m(2, 'ceo', { hidden: true }), m(3)];
    expect(ids(pageBefore(withHidden).messages)).toEqual([1, 3]);
  });

  it('joins an older page in order and without duplicates', () => {
    expect(ids(withOlder([m(5), m(6)], [m(3), m(4), m(5)]))).toEqual([3, 4, 5, 6]);
  });

  it('keeps a tab to CHAT_KEEP messages as new ones arrive, then has older ones to load', () => {
    expect(withNewest([m(1)], m(2), false)).toEqual({ messages: [m(1), m(2)], older: false });
    const full = withNewest(thread(CHAT_KEEP), m(CHAT_KEEP + 1), false);
    expect(full.messages).toHaveLength(CHAT_KEEP);
    expect(full.messages[0].id).toBe(2);
    expect(full.older).toBe(true);
  });
});

describe('scrolling up for older pages', () => {
  it('stays on the same message when a page goes in above', () => {
    // 300 px down a 2000 px list; a 1500 px page (and the spinner's 40 px gone) went in above it.
    expect(anchoredTop({ top: 300, height: 2040 }, 3500)).toBe(1760);
    expect(anchoredTop({ top: 0, height: 1000 }, 1000)).toBe(0);
  });

  it('loads near the top, once at a time, while there is more', () => {
    expect(wantsOlder(LOAD_OLDER_PX - 1, { older: true, loading: false })).toBe(true);
    expect(wantsOlder(LOAD_OLDER_PX + 1, { older: true, loading: false })).toBe(false);
    expect(wantsOlder(0, { older: true, loading: true })).toBe(false);
    expect(wantsOlder(0, { older: false, loading: false })).toBe(false);
  });
});

describe('removing a message', () => {
  it("deletes the manager's and the office's, and only hides the CEO's", () => {
    expect([removal({ from: 'manager' }), removal({ from: 'office' }), removal({ from: 'ceo' })]).toEqual(['delete', 'delete', 'hide']);
    const all = [m(1), m(2, 'office'), m(3, 'ceo')];
    expect(ids(removeMessage(all, 1)!)).toEqual([2, 3]);
    expect(ids(removeMessage(all, 2)!)).toEqual([1, 3]);
    const hidden = removeMessage(all, 3)!;
    expect(hidden.find((x) => x.id === 3)?.hidden).toBe(true);
    expect(ids(pageBefore(hidden).messages)).toEqual([1, 2]);
  });

  it('says when there is nothing to remove', () => {
    expect(removeMessage([m(1)], 9)).toBeNull();
    expect(removeMessage([m(1, 'ceo', { hidden: true })], 1)).toBeNull();
  });
});
