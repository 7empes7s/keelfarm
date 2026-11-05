import { describe, expect, it } from 'vitest';
import {
  conversationsView,
  currentConversation,
  loadChats,
  MAX_CONVERSATIONS,
  openConversation,
  pinConversation,
  searchConversations,
  startConversation,
  titleFrom,
  touchConversation,
  UNTITLED,
} from './conversations.ts';
import type { PhoneMessage } from './types.ts';

const msg = (id: number, from: PhoneMessage['from'], text: string, at = id): PhoneMessage => ({ id, from, text, at });

describe('the conversation store', () => {
  it('gives an office from before conversations one, holding its thread', () => {
    const s = loadChats(undefined, [msg(1, 'office', 'Floor 1 opened'), msg(2, 'manager', 'How is the shop doing?\nAnd the API?'), msg(3, 'ceo', 'Fine.')], 10);
    expect(s.list).toHaveLength(1);
    expect(currentConversation(s)).toMatchObject({ title: 'How is the shop doing?', count: 3, startedAt: 1, updatedAt: 3, pinned: false, sessionId: null });
    expect(loadChats(JSON.parse(JSON.stringify(s)), [], 20)).toEqual(s);
  });

  it('creates a new one, keeping the CEO session the old one resumes, and continues the old one', () => {
    const s = loadChats(undefined, [], 1);
    const first = s.current;
    touchConversation(s, { from: 'manager', text: 'Plan the bakery', at: 5 });
    expect(startConversation(s, 'sess-1', 6)).toEqual([]);
    expect(s.current).not.toBe(first);
    expect(currentConversation(s)).toMatchObject({ title: UNTITLED, count: 0, sessionId: null });
    touchConversation(s, { from: 'office', text: 'A merge', at: 7 });
    expect(currentConversation(s).title).toBe(UNTITLED); // only the manager's words name it
    touchConversation(s, { from: 'manager', text: 'Research: dark mode', at: 8 });
    expect(currentConversation(s).title).toBe('🔎 dark mode');
    expect(openConversation(s, first, 'sess-2')).toBe('sess-1');
    expect(s.current).toBe(first);
    expect(s.list.find((c) => c.id !== first)?.sessionId).toBe('sess-2');
    expect(() => openConversation(s, 'cgone', null)).toThrow(/no longer saved/);
  });

  it('lists pinned ones first, then the latest, without sessions', () => {
    const s = loadChats(undefined, [], 1);
    const a = s.current;
    startConversation(s, null, 2);
    const b = s.current;
    touchConversation(s, { from: 'manager', text: 'B', at: 9 });
    startConversation(s, null, 3);
    pinConversation(s, a, true);
    const view = conversationsView(s);
    expect(view.map((c) => c.id)).toEqual([a, b, s.current]);
    expect(view[0]).not.toHaveProperty('sessionId');
    expect(() => pinConversation(s, 'cgone', true)).toThrow();
  });

  it('drops the oldest unpinned conversations past the cap, never a pinned or the current one', () => {
    const s = loadChats(undefined, [], 0);
    const pinned = s.current;
    pinConversation(s, pinned, true);
    const dropped: string[] = [];
    for (let i = 1; i <= MAX_CONVERSATIONS + 2; i++) dropped.push(...startConversation(s, null, i));
    expect(s.list).toHaveLength(MAX_CONVERSATIONS);
    expect(dropped).toHaveLength(3);
    expect(s.list.some((c) => c.id === pinned)).toBe(true);
    expect(dropped).not.toContain(s.current);
  });

  it('searches titles and messages for every word, with a snippet', () => {
    const list = [
      { id: 'c1', title: 'Bakery plan', startedAt: 0, updatedAt: 0, pinned: false, count: 2 },
      { id: 'c2', title: 'Dark mode', startedAt: 0, updatedAt: 0, pinned: false, count: 1 },
    ];
    const threads = new Map([
      ['c1', [msg(1, 'manager', 'Ship the croissant page on Friday after QA signs off, and tell the team.'), msg(2, 'office', 'dark mode merged')]],
      ['c2', [msg(3, 'ceo', 'The DARK theme is ready.')]],
    ]);
    expect(searchConversations(list, threads, 'croissant friday')).toEqual([{ id: 'c1', snippet: 'Ship the croissant page on Friday after QA signs off, and…' }]);
    expect(searchConversations(list, threads, 'dark').map((h) => h.id)).toEqual(['c2']); // office notes aren't searched
    expect(searchConversations(list, threads, 'bakery')[0]).toEqual({ id: 'c1', snippet: 'Bakery plan' });
    expect(searchConversations(list, threads, '  ')).toEqual([]);
  });

  it('titles a conversation from its first line, shortened', () => {
    expect(titleFrom('\n  Hello there  \nmore')).toBe('Hello there');
    expect(titleFrom('x'.repeat(100))).toHaveLength(60);
    expect(titleFrom('')).toBe(UNTITLED);
  });
});
