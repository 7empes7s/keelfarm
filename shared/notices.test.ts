import { describe, expect, it } from 'vitest';
import { addNotice, keepNotices, makeNotice, markRead, NOTICES_KEEP, noteIdFrom, noticeGroups, noticeOf, sticky, toastMs, toastStack, unreadCount } from './notices';
import type { NoticeView } from './types';

const DAY = 86_400_000;
const now = new Date(2026, 10, 6, 15, 0).getTime();
const n = (id: string, at: number, extra: Partial<NoticeView> = {}): NoticeView => ({ ...makeNotice({ kind: 'merge', title: `Merged ${id}`, text: 'x' }, id, at), ...extra });

describe('makeNotice', () => {
  it('is unread, takes its level from its kind, keeps two distinct actions and one-line texts', () => {
    const x = makeNotice({ kind: 'qaFail', title: 'Failed\nPR #3', text: 'a'.repeat(400), actions: ['openQa', 'openQa', 'openPr', 'retry'] }, 'id1', now);
    expect(x).toMatchObject({ id: 'id1', at: now, level: 'error', title: 'Failed PR #3', read: false, actions: ['openQa', 'openPr'] });
    expect(x.text.length).toBe(300);
    expect(makeNotice({ kind: 'ceo', title: 'Ada', text: 'hi' }, 'i', now)).toMatchObject({ level: 'info', actions: undefined });
    expect(makeNotice({ kind: 'update', level: 'error', title: 'u', text: '' }, 'i', now).level).toBe('error');
  });
});

describe('keepNotices', () => {
  it('keeps the last 100 of the last 7 days, oldest first, and drops malformed ones', () => {
    const many = Array.from({ length: 130 }, (_, i) => n(`n${i}`, now - i * 60_000));
    const kept = keepNotices([...many, n('old', now - 8 * DAY), null, { id: 3 }], now);
    expect(kept).toHaveLength(NOTICES_KEEP);
    expect(kept[0].id).toBe('n99');
    expect(kept.at(-1)!.id).toBe('n0');
    expect(kept.some((x) => x.id === 'old')).toBe(false);
    expect(keepNotices(undefined, now)).toEqual([]);
  });
  it('replaces a notice with the same id', () => {
    const list = addNotice([n('a', now - 5)], n('a', now, { title: 'again' }), now);
    expect(list).toEqual([expect.objectContaining({ id: 'a', title: 'again' })]);
  });
});

describe('read and unread', () => {
  const list = [n('a', now - 3), n('b', now - 2), n('c', now - 1, { read: true })];
  it('counts the unread', () => expect(unreadCount(list)).toBe(2));
  it('marks some, or all, read', () => {
    expect(unreadCount(markRead(list, ['a']))).toBe(1);
    expect(unreadCount(markRead(list, null))).toBe(0);
  });
  it('gives the same list back when nothing changes', () => {
    expect(markRead(list, ['c', 'nope'])).toBe(list);
  });
});

describe('noticeGroups', () => {
  const list = [n('y', now - DAY, { floor: 1 }), n('t1', now - 60_000, { floor: 2, kind: 'qaPass' }), n('t2', now - 1000, { floor: 1 })];
  it('splits Today from Earlier at midnight, newest first', () => {
    expect(noticeGroups(list, now).map((g) => [g.label, g.items.map((x) => x.id)])).toEqual([
      ['Today', ['t2', 't1']],
      ['Earlier', ['y']],
    ]);
  });
  it('filters by floor and kind, leaving out empty groups', () => {
    expect(noticeGroups(list, now, { floor: 1 }).map((g) => g.items.map((x) => x.id))).toEqual([['t2'], ['y']]);
    expect(noticeGroups(list, now, { kind: 'qaPass' })).toEqual([{ label: 'Today', items: [list[1]] }]);
  });
});

describe('toasts', () => {
  it('keeps errors and what needs the manager until dismissed', () => {
    expect(sticky({ kind: 'needsYou' })).toBe(true);
    expect(sticky({ kind: 'error' })).toBe(true);
    expect(sticky({ kind: 'merge' })).toBe(false);
    expect(toastMs('error', { kind: 'stuck' })).toBeNull();
    expect(toastMs('success', { kind: 'merge' })).toBe(7000);
    expect(toastMs('info')).toBe(5000);
  });
  it('collapses a stack beyond max into "+N more"', () => {
    expect(toastStack([1, 2, 3, 4, 5], 3)).toEqual({ shown: [3, 4, 5], more: 2 });
    expect(toastStack([1], 3)).toEqual({ shown: [1], more: 0 });
  });
  it("reads a rich toast's notice; a plain toast has none", () => {
    const x = n('a', now, { target: { kind: 'issue', repoId: 'r', number: 7 }, actions: ['openPr'] });
    expect(noticeOf({ type: 'toast', ...x })).toEqual(x);
    expect(noticeOf({ type: 'toast', level: 'info', text: 'plain' })).toBeNull();
  });
});

describe('noteIdFrom', () => {
  it("reads a push or Telegram link's notice id", () => {
    expect(noteIdFrom('/?tab=approvals&note=mh1x-3')).toBe('mh1x-3');
    expect(noteIdFrom('https://office.example/?note=abc')).toBe('abc');
    expect(noteIdFrom('/?tab=chat')).toBeNull();
    expect(noteIdFrom('/?note=<script>')).toBeNull();
  });
});
